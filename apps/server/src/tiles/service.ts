// Tile-region persistence (DESIGN §7/§9). All exact points stay server-side:
// jobs load them from the DB, and only coarse, rounded boxes reach the admin
// UI. Region filtering/merging lives in ./regions; the MBTiles file is handled
// by ./writer.

import type { Bbox, Point } from "@trespass/shared/geo/types";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { AppDb, DbOrTx } from "../db/client";
import { locations, settings, type TileRegion, tileRegions } from "../db/schema";
import { getEnv } from "../env";
import { enqueueJob } from "../jobs/queue";
import { tilesFileSize } from "./file-size";
import { boxSizeKm, defaultRng, mergeBoxes, needsRegion, newRegionBox, type Rng } from "./regions";
import { exclusiveTileKeys } from "./tiles";
import type { TileWriter } from "./writer";

const MB = 1024 * 1024;

export type AdminTileRegion = {
  id: string;
  kind: "world" | "region";
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  minZoom: number;
  maxZoom: number;
  status: string;
  bytes: number;
  sizeMb: number;
  buildDate: string | null;
  emptySince: string | null;
  error: string | null;
};

/** TILES=off disables both enqueueing and extraction. */
export function tilesEnabled(): boolean {
  return getEnv().TILES === "on";
}

/** Called inside the location's own transaction on create and move. */
export function enqueueTileEnsure(db: DbOrTx, locationId: string): void {
  if (!tilesEnabled()) return;
  enqueueJob(db, "tiles.ensure", { locationId });
}

export const regionBbox = (r: Bbox): Bbox => ({
  minLat: r.minLat,
  minLon: r.minLon,
  maxLat: r.maxLat,
  maxLon: r.maxLon,
});

export function loadTileRegions(db: DbOrTx, kinds?: readonly TileRegion["kind"][]): TileRegion[] {
  const rows = db.select().from(tileRegions).all();
  return kinds ? rows.filter((r) => kinds.includes(r.kind)) : rows;
}

/** Rules 1–3 for one point. Writes the region and its extract job in the CALLER's transaction. */
export function ensureTileRegion(
  db: DbOrTx,
  point: Point,
  opts: { rng?: Rng; now?: Date } = {},
): { regionId: string; mergedIds: string[] } | null {
  const regions = loadTileRegions(db, ["region"]);
  if (!needsRegion(point, regions)) return null;
  const { box, mergedIds } = mergeBoxes(newRegionBox(point, opts.rng ?? defaultRng), regions);
  const regionId = db
    .insert(tileRegions)
    .values({
      kind: "region",
      ...box,
      minZoom: 7,
      maxZoom: 15,
      status: "pending",
      createdAt: opts.now ?? new Date(),
    })
    .returning({ id: tileRegions.id })
    .get().id;
  enqueueJob(db, "tiles.extract", { regionId, mergedIds });
  return { regionId, mergedIds };
}

/** Exactly one location inside is enough to keep a region (SQL, not JS). */
export function locationInsideRegion(db: DbOrTx, box: Bbox): boolean {
  const lat = sql`${locations.lat} BETWEEN ${box.minLat} AND ${box.maxLat}`;
  const lon =
    box.minLon > box.maxLon
      ? sql`(${locations.lon} BETWEEN ${box.minLon} AND 180 OR ${locations.lon} BETWEEN -180 AND ${box.maxLon})`
      : sql`${locations.lon} BETWEEN ${box.minLon} AND ${box.maxLon}`;
  return !!db.select({ id: locations.id }).from(locations).where(and(lat, lon)).limit(1).get();
}

/**
 * daily prune: mark empty regions, clear the mark when a location is back,
 * and drop regions empty for >= 30 days. The caller removes their tiles.
 */
export function pruneEmptyRegions(
  db: DbOrTx,
  now: Date,
): { emptied: string[]; cleared: string[]; expired: TileRegion[] } {
  const emptied: string[] = [];
  const cleared: string[] = [];
  const expired: TileRegion[] = [];
  for (const r of loadTileRegions(db, ["region"])) {
    const inside = locationInsideRegion(db, r);
    if (inside && r.emptySince) {
      db.update(tileRegions).set({ emptySince: null }).where(eq(tileRegions.id, r.id)).run();
      cleared.push(r.id);
    } else if (!inside && !r.emptySince) {
      db.update(tileRegions).set({ emptySince: now }).where(eq(tileRegions.id, r.id)).run();
      emptied.push(r.id);
    }
  }
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  for (const r of loadTileRegions(db, ["region"])) {
    if (r.emptySince && r.emptySince <= cutoff) {
      expired.push(r);
      db.delete(tileRegions).where(eq(tileRegions.id, r.id)).run();
    }
  }
  return { emptied, cleared, expired };
}

/** One stale region per refresh run: re-extractions happen one at a time. */
export function regionToRefresh(db: DbOrTx, now: Date, maxAgeDays = 90): TileRegion | null {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000);
  return (
    db
      .select()
      .from(tileRegions)
      .where(
        and(
          eq(tileRegions.status, "ready"),
          or(isNull(tileRegions.buildDate), lte(tileRegions.buildDate, cutoff)),
        ),
      )
      .orderBy(tileRegions.buildDate, tileRegions.id)
      .limit(1)
      .get() ?? null
  );
}

function areaKm2(bbox: Bbox): number {
  const { widthKm, heightKm } = boxSizeKm(bbox);
  return Math.max(1, widthKm * heightKm);
}

/**
 * Unknown sizes are estimated conservatively: the densest ready region's
 * bytes/km², at least 5 MB; with no data yet, 64 MB per region.
 */
export function estimateRegionBytes(db: DbOrTx, bbox: Bbox): number {
  const ready = db
    .select()
    .from(tileRegions)
    .where(eq(tileRegions.status, "ready"))
    .all()
    .filter((r) => (r.bytes ?? 0) > 0);
  if (ready.length === 0) return 64 * MB;
  const density = Math.max(...ready.map((r) => r.bytes! / areaKm2(r)));
  return Math.max(5 * MB, Math.round(density * areaKm2(bbox)));
}

export function overBudget(currentBytes: number, estimateBytes: number, budgetMb: number): boolean {
  return currentBytes + estimateBytes > budgetMb * MB;
}

export function budgetInfo(db: AppDb, tilesPath: string) {
  const budgetMb =
    db.select({ v: settings.tileBudgetMb }).from(settings).where(eq(settings.id, 1)).get()?.v ??
    10240;
  const bytes = tilesFileSize(tilesPath);
  return { budgetMb, bytes, mb: bytes / MB };
}

/** Admin DTO: rounded box only, no location ids or exact points (§3.4 rule 7). */
const round2 = (n: number) => Math.round(n * 100) / 100;

export function listAdminTileRegions(
  db: AppDb,
  tilesPath: string,
): { regions: AdminTileRegion[]; budgetMb: number; totalMb: number } {
  const budget = budgetInfo(db, tilesPath);
  const regions = db
    .select()
    .from(tileRegions)
    .orderBy(tileRegions.createdAt, tileRegions.id)
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      minLat: round2(r.minLat),
      minLon: round2(r.minLon),
      maxLat: round2(r.maxLat),
      maxLon: round2(r.maxLon),
      minZoom: r.minZoom,
      maxZoom: r.maxZoom,
      status: r.status,
      bytes: r.bytes ?? 0,
      sizeMb: (r.bytes ?? 0) / MB,
      buildDate: r.buildDate ? r.buildDate.toISOString().slice(0, 10) : null,
      emptySince: r.emptySince ? r.emptySince.toISOString().slice(0, 10) : null,
      error: r.error,
    }));
  return { regions, budgetMb: budget.budgetMb, totalMb: budget.mb };
}

/** Removes the tiles of a deleted region that no remaining region covers. */
export function deleteExclusiveRegionTiles(
  writer: TileWriter,
  region: TileRegion,
  others: readonly TileRegion[],
): number {
  const keys = exclusiveTileKeys(region, others);
  if (keys.length === 0) return 0;
  return writer.deleteTiles(
    [...keys].map((key) => {
      const [z, x, y] = key.split("/").map(Number);
      return { z: z!, x: x!, y: y!, data: new Uint8Array(0) };
    }),
  );
}

/** Pending/ready world region already exists: keep the world layer singular. */
export function ensureWorldRegion(db: DbOrTx, now: Date): string | null {
  const existing = db
    .select({ id: tileRegions.id })
    .from(tileRegions)
    .where(eq(tileRegions.kind, "world"))
    .limit(1)
    .get();
  if (existing) return null;
  const id = db
    .insert(tileRegions)
    .values({
      kind: "world",
      minLat: -85,
      minLon: -180,
      maxLat: 85,
      maxLon: 180,
      minZoom: 0,
      maxZoom: 6,
      status: "pending",
      createdAt: now,
    })
    .returning({ id: tileRegions.id })
    .get().id;
  enqueueJob(db, "tiles.extract", { regionId: id });
  return id;
}
