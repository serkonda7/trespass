// Pure tile-region geometry (DESIGN §7.2). No DB, no I/O.
// - Boxes ≥ 20 × 20 km, point at a random offset with ≥ 5 km padding, so the
//   area never points at a pin.
// - Longitudes may wrap (minLon > maxLon); the extractor splits them.
// - Latitudes (and points) clamp to ±85 (Web Mercator).
import type { Bbox, Point } from "@trespass/shared/geo/types";

/** Approximate metric degrees at the equator (6 371 008 m/rad). */
const KM_PER_DEG_LAT = 111.32;
export const MIN_BOX_KM = 20;
export const EDGE_MARGIN_KM = 5;
export const MERGE_GAP_KM = 10;
export const MAX_LAT = 85;

export type RegionLike = Bbox & {
  id: string;
  /** Failed regions do not cover anything; merged-away rows are not consulted. */
  status?: string;
  /** Only region boxes (z7–15) cover points; the world layer does not. */
  kind?: string;
};

export type Rng = () => number;

/** Crypto-backed RNG by default; tests inject a deterministic one. */
export const defaultRng: Rng = () =>
  globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

export function wrapLon(lon: number): number {
  let x = lon;
  while (x < -180) x += 360;
  while (x >= 180) x -= 360;
  return x;
}

/** Signed shortest longitude difference `b - a`, in degrees. */
export function lonDelta(a: number, b: number): number {
  return wrapLon(b - a);
}

/** Eastward angular span of a box (wrapped boxes included). */
export function lonSpan(box: Bbox): number {
  return wrapLon(box.maxLon - box.minLon);
}

function kmPerDegLon(lat: number): number {
  // Near the poles a degree is tiny; the floor keeps the maths finite.
  return KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
}

function unwrapLon(lon: number, reference: number): number {
  return reference + lonDelta(reference, lon);
}

/** Eastward distance from the box's west edge to the point, in degrees. */
function eastOfWestEdge(box: Bbox, lon: number): number {
  return wrapLon(lon - box.minLon);
}

/**
 * True when the point is inside the box and at least `marginKm` from every
 * edge. Longitude uses wrapped distances, so antimeridian boxes work too.
 */
export function insideWithMargin(point: Point, box: Bbox, marginKm = EDGE_MARGIN_KM): boolean {
  const lat = Math.min(MAX_LAT, Math.max(-MAX_LAT, point.lat));
  // A little slack absorbs degree<->km round-off at the exact 5 km boundary.
  const margin = marginKm - 1e-6;
  if ((lat - box.minLat) * KM_PER_DEG_LAT < margin) return false;
  if ((box.maxLat - lat) * KM_PER_DEG_LAT < margin) return false;
  const span = lonSpan(box);
  const off = eastOfWestEdge(box, wrapLon(point.lon));
  if (off > span) return false;
  const scale = kmPerDegLon(lat);
  return off * scale >= margin && (span - off) * scale >= margin;
}

/** Point-in-box without a margin (used when pruning empty regions). */
export function insideBox(point: Point, box: Bbox): boolean {
  if (point.lat < box.minLat || point.lat > box.maxLat) return false;
  const span = lonSpan(box);
  const off = eastOfWestEdge(box, wrapLon(point.lon));
  return off <= span;
}

/**
 * Rule 1: a point needs a new region unless it is already covered by a
 * non-failed region box with at least 5 km to every edge.
 */
export function needsRegion(point: Point, regions: readonly RegionLike[]): boolean {
  return !regions.some(
    (r) =>
      r.kind !== "world" && r.status !== "failed" && insideWithMargin(point, r, EDGE_MARGIN_KM),
  );
}

/** Approximate side lengths of a box in km. */
export function boxSizeKm(box: Bbox): { widthKm: number; heightKm: number } {
  const midLat = (box.minLat + box.maxLat) / 2;
  return {
    widthKm: lonSpan(box) * kmPerDegLon(midLat),
    heightKm: (box.maxLat - box.minLat) * KM_PER_DEG_LAT,
  };
}

/** Rule 2: random-size box ≥ 20 × 20 km, point uniformly placed ≥ 5 km from each edge. */
export function newRegionBox(point: Point, rng: Rng = defaultRng): Bbox {
  const widthKm = MIN_BOX_KM + rng() * 20;
  const heightKm = MIN_BOX_KM + rng() * 20;
  const insetLatKm = EDGE_MARGIN_KM + rng() * (heightKm - 2 * EDGE_MARGIN_KM);
  const insetLonKm = EDGE_MARGIN_KM + rng() * (widthKm - 2 * EDGE_MARGIN_KM);

  let minLat = point.lat - insetLatKm / KM_PER_DEG_LAT;
  let maxLat = minLat + heightKm / KM_PER_DEG_LAT;
  if (minLat < -MAX_LAT) {
    maxLat += -MAX_LAT - minLat;
    minLat = -MAX_LAT;
  }
  if (maxLat > MAX_LAT) {
    minLat -= maxLat - MAX_LAT;
    maxLat = MAX_LAT;
  }

  // Size by the poleward edge so the box is >= 20 km wide everywhere in it.
  const edgeLat = Math.abs(minLat) > Math.abs(maxLat) ? minLat : maxLat;
  const scaleLon = kmPerDegLon(edgeLat);
  const minLon = wrapLon(point.lon - insetLonKm / scaleLon);
  const maxLon = wrapLon(minLon + widthKm / scaleLon);
  return { minLat, minLon, maxLat, maxLon };
}

/** Smallest gap between two boxes in km (0 when they overlap). */
export function boxGapKm(a: Bbox, b: Bbox): number {
  const latSep = Math.max(0, a.minLat - b.maxLat, b.minLat - a.maxLat) * KM_PER_DEG_LAT;
  const aCenter = wrapLon(a.minLon + lonSpan(a) / 2);
  const bCenter = wrapLon(b.minLon + lonSpan(b) / 2);
  // Unwrap both boxes around a's centre, then compare the ordinary intervals.
  const aMin = unwrapLon(a.minLon, aCenter);
  const aMax = aMin + lonSpan(a);
  let bMin = unwrapLon(b.minLon, aCenter);
  bMin += Math.round((bCenter - aCenter) / 360) * 360;
  if (bMin < aMin - 180) bMin += 360;
  if (bMin > aMin + 180) bMin -= 360;
  const bMax = bMin + lonSpan(b);
  const lonSepDeg = Math.max(0, aMin - bMax, bMin - aMax);
  const lonSep = lonSepDeg * kmPerDegLon((a.minLat + a.maxLat + b.minLat + b.maxLat) / 4);
  return Math.hypot(latSep, lonSep);
}

/** Bounding box of the union, with longitudes unwrapped around `a`. */
export function unionBoxes(a: Bbox, b: Bbox): Bbox {
  const center = wrapLon(a.minLon + lonSpan(a) / 2);
  const aMin = unwrapLon(a.minLon, center);
  const aMax = aMin + lonSpan(a);
  let bMin = unwrapLon(b.minLon, center);
  const bCenter = wrapLon(b.minLon + lonSpan(b) / 2);
  bMin += Math.round((bCenter - center) / 360) * 360;
  if (bMin < aMin - 180) bMin += 360;
  if (bMin > aMin + 180) bMin -= 360;
  const bMax = bMin + lonSpan(b);
  const min = Math.min(aMin, bMin);
  const max = Math.max(aMax, bMax);
  return {
    minLat: Math.max(-MAX_LAT, Math.min(a.minLat, b.minLat)),
    maxLat: Math.min(MAX_LAT, Math.max(a.maxLat, b.maxLat)),
    minLon: max - min >= 360 ? -180 : wrapLon(min),
    maxLon: max - min >= 360 ? 180 : wrapLon(max),
  };
}

/** Rule 3: merge with regions overlapping or < 10 km away, transitively. Returns replaced ids. */
export function mergeBoxes(
  newBox: Bbox,
  regions: readonly RegionLike[],
): { box: Bbox; mergedIds: string[] } {
  let box = { ...newBox };
  const mergedIds: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of regions) {
      if (mergedIds.includes(r.id)) continue;
      if (boxGapKm(box, r) <= MERGE_GAP_KM) {
        box = unionBoxes(box, r);
        mergedIds.push(r.id);
        changed = true;
      }
    }
  }
  return { box, mergedIds };
}
