// Metric geo maths (DESIGN §9). Dependency-free helpers used by the location
// service and by tests; all coordinates are WGS84 in degrees.
import type { Bbox, Point } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/** Great-circle distance in metres. */
export function haversineMeters(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * TO_RAD;
  const dLon = (b.lon - a.lon) * TO_RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * TO_RAD) * Math.cos(b.lat * TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function wrapLon(lon: number): number {
  let x = lon;
  while (x < -180) x += 360;
  while (x >= 180) x -= 360;
  return x;
}

/** A bounding box around a point. Near the poles the longitude span is global. */
export function bboxAround(point: Point, meters: number): Bbox {
  const dLat = (meters / EARTH_RADIUS_M) * TO_DEG;
  const minLat = Math.max(-90, point.lat - dLat);
  const maxLat = Math.min(90, point.lat + dLat);
  const cosLat = Math.cos(point.lat * TO_RAD);
  const lonSpan = Math.abs(cosLat) < 1e-9 ? 180 : Math.min(180, dLat / Math.abs(cosLat));
  if (lonSpan >= 180) return { minLat, minLon: -180, maxLon: 180, maxLat };
  return {
    minLat,
    minLon: wrapLon(point.lon - lonSpan),
    maxLon: wrapLon(point.lon + lonSpan),
    maxLat,
  };
}

/**
 * Splits a bbox that crosses the antimeridian (minLon > maxLon) into two
 * ordinary boxes. Returns one box otherwise. Callers apply `BETWEEN` to both.
 */
export function splitBbox(bbox: Bbox): Bbox[] {
  const { minLat, maxLat } = bbox;
  const minLon = wrapLon(bbox.minLon);
  const maxLon = wrapLon(bbox.maxLon);
  if (minLon <= maxLon) return [{ ...bbox, minLon, maxLon }];
  return [
    { minLat, minLon, maxLat, maxLon: 180 },
    { minLat, minLon: -180, maxLat, maxLon },
  ];
}
