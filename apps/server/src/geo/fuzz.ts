// The single fuzzed point per location (DESIGN §3.4 rule 1). Generated once
// at creation and reused by every viewer; never recomputed per request.
// Uniform over the disc (sqrt of the random radius), with a floor of 10% of
// the radius so the public point is never accidentally identical to the exact
// one. `rng` is injectable for deterministic tests.
import type { Point } from "@trespass/shared/geo/types";

const EARTH_RADIUS_M = 6_371_000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;
const MIN_RADIUS_FRACTION = 0.1;

function wrapLon(lon: number): number {
  let x = lon;
  while (x < -180) x += 360;
  while (x >= 180) x -= 360;
  return x;
}

/** A random point uniformly inside `radiusM` of `point`, at least 10% away. */
export function fuzzPoint(point: Point, radiusM: number, rng: () => number = Math.random): Point {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return { ...point };
  const angle = 2 * Math.PI * rng();
  const distance = radiusM * (MIN_RADIUS_FRACTION + (1 - MIN_RADIUS_FRACTION) * Math.sqrt(rng()));
  const dLat = (distance / EARTH_RADIUS_M) * TO_DEG;
  const cosLat = Math.cos(point.lat * TO_RAD);
  const dLon = Math.abs(cosLat) < 1e-9 ? 0 : dLat / cosLat;
  const lat = Math.max(-90, Math.min(90, point.lat + dLat * Math.sin(angle)));
  const lon = wrapLon(point.lon + dLon * Math.cos(angle));
  return { lat, lon };
}
