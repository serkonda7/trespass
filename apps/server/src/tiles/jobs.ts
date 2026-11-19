// Tile jobs (DESIGN §7.2), registered in ../jobs/handlers.ts and run by the
// standalone worker only. Every handler is idempotent and watches `signal`.
// Logs carry region ids, never coordinates or location ids.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { locations, tileRegions } from "../db/schema";
import { getEnv } from "../env";
import { enqueueJob, hasPendingJob } from "../jobs/queue";
import { nextDailyInBerlin } from "../jobs/schedule";
import { addJobHandler, type JobRegistry } from "../jobs/worker";
import { getSettings } from "../settings/service";
import { createPmTilesExtractor } from "./pmtiles-extractor";
import type { Rng } from "./regions";
import {
  deleteExclusiveRegionTiles,
  ensureTileRegion,
  ensureWorldRegion,
  estimateRegionBytes,
  loadTileRegions,
  overBudget,
  pruneEmptyRegions,
  regionBbox,
  regionToRefresh,
  tilesEnabled,
} from "./service";
import type { TileEntry, TileExtractor } from "./types";
import { BATCH_SIZE, openTileWriter, type TileWriter, tilesFileSize } from "./writer";

export const ENSURE_JOB = "tiles.ensure";
export const EXTRACT_JOB = "tiles.extract";
export const WORLD_JOB = "tiles.world";
export const PRUNE_JOB = "tiles.prune";
export const REFRESH_JOB = "tiles.refresh";
export const DELETE_JOB = "tiles.delete";

export type TileJobDeps = {
  extractor?: TileExtractor;
  openWriter?: (path: string) => TileWriter;
  tilesPath?: () => string;
  enabled?: () => boolean;
  now?: () => Date;
  rng?: Rng;
  log?: (msg: string) => void;
};

const ensurePayload = z.object({ locationId: z.string().min(1) });
const extractPayload = z.object({
  regionId: z.string().min(1),
  mergedIds: z.array(z.string()).optional(),
  force: z.boolean().optional(),
});
const idPayload = z.object({ regionId: z.string().min(1) });

export function addTileJobs(registry: JobRegistry, deps: TileJobDeps = {}) {
  const extractor = deps.extractor ?? createPmTilesExtractor();
  const openWriter = deps.openWriter ?? openTileWriter;
  const tilesPath = deps.tilesPath ?? (() => getEnv().TILES_PATH);
  const enabled = deps.enabled ?? tilesEnabled;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((msg: string) => console.log(`[tiles] ${msg}`));

  addJobHandler(
    registry,
    ENSURE_JOB,
    (payload, { db }) => {
      if (!enabled()) return;
      const { locationId } = ensurePayload.parse(payload);
      // Exact point, loaded server-side and never logged or serialized (§3.4).
      const point = db
        .select({ lat: locations.lat, lon: locations.lon })
        .from(locations)
        .where(eq(locations.id, locationId))
        .get();
      if (!point) return; // the location was deleted before the job ran
      const result = db.transaction((tx) => ensureTileRegion(tx, point, { rng: deps.rng }));
      if (result) log(`${result.regionId} queued for extraction`);
    },
    { maxAttempts: 3, backoffBaseMs: 10_000 },
  );

  addJobHandler(
    registry,
    EXTRACT_JOB,
    async (payload, { db, signal }) => {
      if (!enabled()) return;
      const { regionId, mergedIds = [], force = false } = extractPayload.parse(payload);
      const region = db.select().from(tileRegions).where(eq(tileRegions.id, regionId)).get();
      if (!region) return;
      if (region.status === "ready" && !force && region.buildDate) return;
      if (region.status === "extracting" && !force) return;

      db.update(tileRegions)
        .set({ status: "extracting", error: null })
        .where(eq(tileRegions.id, regionId))
        .run();
      const path = tilesPath();
      const writer = openWriter(path);
      try {
        if (signal?.aborted) throw new Error("aborted");
        const estimate = region.bytes ?? estimateRegionBytes(db, regionBbox(region));
        const budgetMb = getSettings(db).tileBudgetMb;
        if (overBudget(tilesFileSize(path), estimate, budgetMb)) {
          // Permanent until the budget is raised: do not retry forever.
          db.update(tileRegions)
            .set({ status: "failed", error: "budget" })
            .where(eq(tileRegions.id, regionId))
            .run();
          log(`${regionId} failed: budget`);
          return;
        }

        const build = await extractor.latestBuild();
        const stream = extractor.extract({
          bbox: regionBbox(region),
          minZoom: region.minZoom,
          maxZoom: region.maxZoom,
          buildUrl: build.url,
          signal,
        });
        let batch: TileEntry[] = [];
        let bytes = 0;
        for await (const tile of stream) {
          if (signal?.aborted) throw new Error("aborted");
          batch.push(tile);
          bytes += tile.data.length;
          if (batch.length >= BATCH_SIZE) {
            writer.writeTiles(batch);
            batch = [];
          }
        }
        if (signal?.aborted) throw new Error("aborted");
        writer.writeTiles(batch);
        const json = stream.metadata?.()?.json;
        writer.setMetadata({
          name: "Trespass",
          format: "pbf",
          minzoom: String(region.minZoom),
          maxzoom: String(region.maxZoom),
          attribution: "© OpenStreetMap contributors, © Protomaps",
          ...(json ? { json } : {}),
        });
        db.transaction((tx) => {
          tx.update(tileRegions)
            .set({
              status: "ready",
              bytes,
              buildDate: new Date(`${build.date}T00:00:00Z`),
              refreshedAt: now(),
              error: null,
            })
            .where(eq(tileRegions.id, regionId))
            .run();
          // Merged rows disappear only after the union has been extracted;
          // their old tiles stay in the MBTiles file and remain valid.
          for (const id of mergedIds) {
            tx.delete(tileRegions).where(eq(tileRegions.id, id)).run();
          }
        });
        log(`${regionId} ready (build ${build.date})`);
      } catch (err) {
        if (signal?.aborted) {
          // The interrupted job is retried after its lease is released.
          db.update(tileRegions)
            .set({ status: "pending" })
            .where(eq(tileRegions.id, regionId))
            .run();
          return;
        }
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        db.update(tileRegions)
          .set({ status: "failed", error: message })
          .where(eq(tileRegions.id, regionId))
          .run();
        throw err;
      } finally {
        writer.close();
      }
    },
    { maxAttempts: 3, backoffBaseMs: 15_000, timeoutMs: 600_000 },
  );

  addJobHandler(
    registry,
    WORLD_JOB,
    (_payload, { db }) => {
      if (!enabled()) return;
      const id = db.transaction((tx) => ensureWorldRegion(tx, now()));
      if (id) log(`${id} (world) queued for extraction`);
    },
    { maxAttempts: 3, backoffBaseMs: 10_000 },
  );

  addJobHandler(
    registry,
    PRUNE_JOB,
    (_payload, { db, signal }) => {
      if (!enabled()) return;
      const result = db.transaction((tx) => pruneEmptyRegions(tx, now()));
      if (result.emptied.length || result.cleared.length) {
        log(
          `${result.emptied.length} empty, ${result.cleared.length} active, ${result.expired.length} expired`,
        );
      }
      if (result.expired.length === 0) return;
      const remaining = loadTileRegions(db);
      const writer = openWriter(tilesPath());
      try {
        for (const region of result.expired) {
          if (signal?.aborted) return;
          const n = deleteExclusiveRegionTiles(writer, region, remaining);
          if (n) log(`${region.id} pruned (${n} tiles)`);
        }
      } finally {
        writer.close();
      }
    },
    { recurring: { next: (at) => nextDailyInBerlin(at, 3, 30) } },
  );

  addJobHandler(
    registry,
    REFRESH_JOB,
    (_payload, { db }) => {
      if (!enabled() || hasPendingJob(db, EXTRACT_JOB)) return;
      const stale = regionToRefresh(db, now());
      if (!stale) return;
      // One at a time: the next daily run picks the next stale region.
      enqueueJob(db, EXTRACT_JOB, { regionId: stale.id, force: true });
      log(`${stale.id} queued for refresh`);
    },
    { recurring: { next: (at) => nextDailyInBerlin(at, 4) } },
  );

  addJobHandler(
    registry,
    DELETE_JOB,
    (payload, { db, signal }) => {
      if (!enabled()) return;
      const { regionId } = idPayload.parse(payload);
      const region = db.select().from(tileRegions).where(eq(tileRegions.id, regionId)).get();
      if (!region) return;
      db.delete(tileRegions).where(eq(tileRegions.id, regionId)).run();
      if (signal?.aborted) return;
      const others = loadTileRegions(db);
      const writer = openWriter(tilesPath());
      try {
        const n = deleteExclusiveRegionTiles(writer, region, others);
        log(`${regionId} deleted (${n} tiles)`);
      } finally {
        writer.close();
      }
    },
    { maxAttempts: 3, backoffBaseMs: 10_000 },
  );
}
