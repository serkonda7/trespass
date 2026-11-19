// Slippy-map tile arithmetic used by pruning (DESIGN §7.2): decide which
// z7–15 tiles belong exclusively to a region so they can be removed when the
// region is deleted. Pure maths, no I/O.

import { splitBbox } from "@trespass/shared/geo/distance";
import type { Bbox } from "@trespass/shared/geo/types";
import { MAX_LAT, wrapLon } from "./regions";

const MAX_MERCATOR_LAT = 85.05112878;

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((wrapLon(lon) + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const raw = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(raw)));
}

export type TileRange = { z: number; xMin: number; xMax: number; yMin: number; yMax: number };

/** Tile ranges covering a bbox at one zoom, split at the antimeridian. */
export function tileRangeForBbox(bbox: Bbox, z: number): TileRange[] {
  const latMin = Math.max(-MAX_LAT, Math.min(MAX_LAT, bbox.minLat));
  const latMax = Math.max(-MAX_LAT, Math.min(MAX_LAT, bbox.maxLat));
  return splitBbox({ ...bbox, minLat: latMin, maxLat: latMax }).map((part) => ({
    z,
    xMin: lonToTileX(part.minLon, z),
    xMax: lonToTileX(part.maxLon, z),
    // y grows southwards: minLat is the higher tile row number.
    yMin: latToTileY(part.maxLat, z),
    yMax: latToTileY(part.minLat, z),
  }));
}

export const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** All tile keys of a box over a zoom range (bounded to keep pruning safe). */
export function tileKeysForBbox(
  bbox: Bbox,
  minZoom: number,
  maxZoom: number,
  maxKeys = 2_000_000,
): Set<string> {
  const keys = new Set<string>();
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const r of tileRangeForBbox(bbox, z)) {
      for (let x = r.xMin; x <= r.xMax; x++) {
        for (let y = r.yMin; y <= r.yMax; y++) {
          keys.add(tileKey(z, x, y));
          if (keys.size > maxKeys) throw new Error("tile range too large");
        }
      }
    }
  }
  return keys;
}

/**
 * Keys of `region`'s tiles that no other region covers. World tiles (z0–6)
 * are never removed: only region tiles (z7–15) are exclusive.
 */
export function exclusiveTileKeys(
  region: Bbox & { minZoom: number; maxZoom: number },
  others: readonly (Bbox & { minZoom: number; maxZoom: number })[],
): string[] {
  const from = Math.max(7, region.minZoom);
  const to = region.maxZoom;
  if (to < from) return [];
  const mine = tileKeysForBbox(region, from, to);
  for (const other of others) {
    const oFrom = Math.max(7, other.minZoom);
    if (other.maxZoom < oFrom) continue;
    for (const key of tileKeysForBbox(other, oFrom, other.maxZoom)) mine.delete(key);
  }
  return [...mine].sort();
}
