// Polygon helpers for research search areas (DESIGN §6.2). Rings are GeoJSON
// order ([lon, lat]) and closed (first point == last point). Areas are small
// (tens of km), so a planar approximation with a cos(lat) correction is fine.
import type { Bbox, GeoJsonPolygon, Point } from "./types";

export type Ring = [number, number][];

const EARTH_KM_PER_DEG = 111.32;

/** Closes a ring if needed and drops consecutive duplicate points. */
export function closeRing(points: readonly (readonly [number, number])[]): Ring {
  const out: Ring = [];
  for (const [lon, lat] of points) {
    const last = out[out.length - 1];
    if (last && last[0] === lon && last[1] === lat) continue;
    out.push([lon, lat]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
    out.push([first[0], first[1]]);
  return out;
}

/** Number of distinct vertices of a closed ring. */
export const vertexCount = (ring: Ring) => Math.max(0, ring.length - 1);

/** Ray casting; points exactly on an edge may fall either way. */
export function pointInRing(point: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses =
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Point, polygon: GeoJsonPolygon): boolean {
  const [outer, ...holes] = polygon.coordinates as Ring[];
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((h) => pointInRing(point, h));
}

export function ringBbox(ring: Ring): Bbox {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const [lon, lat] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return { minLat, minLon, maxLat, maxLon };
}

/** Approximate area of a ring in km² (shoelace on a locally scaled plane). */
export function ringAreaKm2(ring: Ring): number {
  if (ring.length < 4) return 0;
  const midLat = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length;
  const kx = EARTH_KM_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const ky = EARTH_KM_PER_DEG;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(sum) / 2;
}

/** A closed ring approximating a circle of `radiusKm` around `center`. */
export function circleRing(center: Point, radiusKm: number, steps = 48): Ring {
  const dLat = radiusKm / EARTH_KM_PER_DEG;
  const dLon =
    radiusKm / (EARTH_KM_PER_DEG * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const lon = Math.round((center.lon + dLon * Math.cos(a)) * 1e6) / 1e6;
    const lat = Math.round((center.lat + dLat * Math.sin(a)) * 1e6) / 1e6;
    ring.push([Math.min(180, Math.max(-180, lon)), Math.min(90, Math.max(-90, lat))]);
  }
  return closeRing(ring);
}

/** True when two segments properly cross (shared endpoints do not count). */
function segmentsCross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** True when no two non-adjacent edges of the ring cross. */
export function isSimpleRing(ring: Ring): boolean {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing point
      if (segmentsCross(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
    }
  }
  return true;
}
