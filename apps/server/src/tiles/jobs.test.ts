import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { seed } from "../authz/test-fixtures";
import { settings, tileRegions } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { enqueueJob } from "../jobs/queue";
import { createJobRegistry, createJobWorker } from "../jobs/worker";
import {
  addTileJobs,
  DELETE_JOB,
  ENSURE_JOB,
  EXTRACT_JOB,
  PRUNE_JOB,
  REFRESH_JOB,
  type TileJobDeps,
  WORLD_JOB,
} from "./jobs";
import { createTileReader, readTile } from "./store";
import { exclusiveTileKeys, latToTileY, lonToTileX, tileKey } from "./tiles";
import type { TileEntry, TileExtractor } from "./types";
import { openTileWriter } from "./writer";

const dirs: string[] = [];
function setup(opts: Partial<TileJobDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "trespass-tile-jobs-"));
  dirs.push(dir);
  const db = createTestDb();
  const tilesPath = join(dir, "tiles.sqlite");
  const registry = createJobRegistry();
  const fake: TileExtractor = {
    latestBuild: async () => ({ url: "https://example.test/build.pmtiles", date: "2026-11-18" }),
    extract: ({ signal }) =>
      Object.assign(
        (async function* (): AsyncGenerator<TileEntry> {
          signal?.throwIfAborted();
          yield { z: 7, x: 1, y: 1, data: new Uint8Array([0x1f, 0x8b, 7]) };
        })(),
        { metadata: () => ({ json: '{"vector_layers":[]}' }) },
      ),
  };
  const deps: TileJobDeps = {
    extractor: opts.extractor ?? fake,
    tilesPath: () => tilesPath,
    enabled: opts.enabled ?? (() => true),
    now: opts.now ?? (() => new Date("2026-11-18T12:00:00Z")),
    rng: opts.rng ?? (() => 0.5),
    log: () => {},
  };
  addTileJobs(registry, deps);
  // The claim clock is the real one (enqueueJob uses Date.now); the injected
  // `deps.now` only controls job logic such as prune cutoffs.
  const worker = createJobWorker({ db, registry });
  return { db, dir, tilesPath, worker, registry };
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const regionRows = (db: ReturnType<typeof createTestDb>) => db.select().from(tileRegions).all();

describe("tiles.ensure / tiles.extract", () => {
  test("ensure creates one region and the extract job makes it ready", async () => {
    const { db, tilesPath, worker } = setup();
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 51, lon: 7 }],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    expect(await worker.drain()).toBe(2); // ensure + extract
    const rows = regionRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.minZoom).toBe(7);
    expect(rows[0]!.maxZoom).toBe(15);
    expect(rows[0]!.bytes).toBeGreaterThan(0);
    expect(rows[0]!.buildDate).toEqual(new Date("2026-11-18T00:00:00Z"));
    const reader = createTileReader(tilesPath);
    expect(readTile(reader, 7, 1, 1)).toEqual(new Uint8Array([0x1f, 0x8b, 7]));
    const meta = openTileWriter(tilesPath);
    expect(meta.getMetadata().attribution).toContain("OpenStreetMap");
    expect(meta.getMetadata().json).toContain("vector_layers");
    meta.close();
    // Idempotence: the same point is already covered, no second region.
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    expect(await worker.drain()).toBe(1);
    expect(regionRows(db).length).toBe(1);
  });

  test("a nearby second region merges and replaces the old row", async () => {
    const { db, worker } = setup();
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [
        { id: "l1", ownerId: "u", lat: 51, lon: 7 },
        { id: "l2", ownerId: "u", lat: 51.2, lon: 7 },
      ],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    await worker.drain();
    const first = regionRows(db)[0]!;
    enqueueJob(db, ENSURE_JOB, { locationId: "l2" });
    await worker.drain();
    const rows = regionRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).not.toBe(first.id);
    expect(rows[0]!.minLat).toBeLessThan(51);
    expect(rows[0]!.maxLat).toBeGreaterThan(51.2);
  });

  test("budget refusal fails the region without writing tiles", async () => {
    const { db, tilesPath, worker } = setup();
    db.update(settings).set({ tileBudgetMb: 1 }).where(eq(settings.id, 1)).run();
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 51, lon: 7 }],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    await worker.drain();
    const rows = regionRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toBe("budget");
    const reader = createTileReader(tilesPath);
    expect(readTile(reader, 7, 1, 1)).toBeNull();
  });

  test("TILES=off does nothing", async () => {
    const { db, worker } = setup({ enabled: () => false });
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 51, lon: 7 }],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    await worker.drain();
    expect(regionRows(db).length).toBe(0);
  });
});

describe("tiles.prune / tiles.delete", () => {
  const z = 12;
  const at = (lat: number, lon: number) => ({
    z,
    x: lonToTileX(lon, z),
    y: latToTileY(lat, z),
    data: new Uint8Array([1]),
  });
  const inA = at(50.02, 6.02);
  const overlap = at(50.15, 6.15);
  const inB = at(50.25, 6.25);

  function insertRegion(
    db: ReturnType<typeof createTestDb>,
    id: string,
    box: { minLat: number; minLon: number; maxLat: number; maxLon: number },
    emptySince: Date | null,
  ) {
    db.insert(tileRegions)
      .values({
        id,
        ...box,
        minZoom: 7,
        maxZoom: 15,
        status: "ready",
        buildDate: new Date("2026-01-01T00:00:00Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
        emptySince,
        bytes: 3,
      })
      .run();
  }

  test("a region empty for 30 days is deleted; overlapping tiles stay", async () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const { db, tilesPath, worker } = setup({ now: () => now });
    const a = { minLat: 50, minLon: 6, maxLat: 50.2, maxLon: 6.2 };
    const b = { minLat: 50.1, minLon: 6.1, maxLat: 50.3, maxLon: 6.3 };
    insertRegion(db, "ra", a, new Date(now.getTime() - 31 * 86_400_000));
    insertRegion(db, "rb", b, null);
    const writer = openTileWriter(tilesPath);
    writer.writeTiles([inA, overlap, inB]);
    writer.close();
    // A location inside B keeps B alive; A has none and is already expired.
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 50.25, lon: 6.25 }],
    });
    enqueueJob(db, PRUNE_JOB, {});
    await worker.drain();
    expect(regionRows(db).map((r) => r.id)).toEqual(["rb"]);
    const reader = createTileReader(tilesPath);
    expect(readTile(reader, inA.z, inA.x, inA.y)).toBeNull();
    expect(readTile(reader, overlap.z, overlap.x, overlap.y)).toEqual(new Uint8Array([1]));
    expect(readTile(reader, inB.z, inB.x, inB.y)).toEqual(new Uint8Array([1]));
  });

  test("empty_since is cleared when a location comes back", async () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const { db, worker } = setup({ now: () => now });
    insertRegion(db, "r", { minLat: 50, minLon: 6, maxLat: 50.2, maxLon: 6.2 }, now);
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 50.1, lon: 6.1 }],
    });
    enqueueJob(db, PRUNE_JOB, {});
    await worker.drain();
    expect(regionRows(db)[0]!.emptySince).toBeNull();
  });

  test("tiles.delete removes the row and its exclusive tiles", async () => {
    const { db, tilesPath, worker } = setup();
    const a = { minLat: 50, minLon: 6, maxLat: 50.2, maxLon: 6.2 };
    const b = { minLat: 50.1, minLon: 6.1, maxLat: 50.3, maxLon: 6.3 };
    insertRegion(db, "ra", a, null);
    insertRegion(db, "rb", b, null);
    const writer = openTileWriter(tilesPath);
    writer.writeTiles([inA, overlap, inB]);
    writer.close();
    enqueueJob(db, DELETE_JOB, { regionId: "ra" });
    await worker.drain();
    expect(regionRows(db).map((r) => r.id)).toEqual(["rb"]);
    const reader = createTileReader(tilesPath);
    expect(readTile(reader, inA.z, inA.x, inA.y)).toBeNull();
    expect(readTile(reader, overlap.z, overlap.x, overlap.y)).toEqual(new Uint8Array([1]));
  });

  test("exclusive tile keys are calculated per zoom", () => {
    const { db } = setup();
    const a = { minLat: 50, minLon: 6, maxLat: 50.2, maxLon: 6.2, minZoom: 7, maxZoom: 15 };
    const b = { minLat: 50.1, minLon: 6.1, maxLat: 50.3, maxLon: 6.3, minZoom: 7, maxZoom: 15 };
    const keys = exclusiveTileKeys(a, [b]);
    expect(keys).toContain(tileKey(inA.z, inA.x, inA.y));
    expect(keys).not.toContain(tileKey(overlap.z, overlap.x, overlap.y));
    db.$client.close();
  });
});

describe("tiles.world / tiles.refresh", () => {
  test("the world job creates a single z0–6 region", async () => {
    const { db, worker } = setup();
    enqueueJob(db, WORLD_JOB, {});
    await worker.drain();
    const rows = regionRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("world");
    expect(rows[0]!.minZoom).toBe(0);
    expect(rows[0]!.maxZoom).toBe(6);
    expect(rows[0]!.status).toBe("ready");
    enqueueJob(db, WORLD_JOB, {});
    await worker.drain();
    expect(regionRows(db).length).toBe(1);
  });

  test("refresh re-extracts a stale region and updates its build date", async () => {
    const { db, worker } = setup();
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 51, lon: 7 }],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    await worker.drain();
    const before = regionRows(db)[0]!;
    db.update(tileRegions)
      .set({ buildDate: new Date("2026-01-01T00:00:00Z") })
      .where(eq(tileRegions.id, before.id))
      .run();
    enqueueJob(db, REFRESH_JOB, {});
    await worker.drain();
    expect(regionRows(db)[0]!.buildDate).toEqual(new Date("2026-11-18T00:00:00Z"));
  });
});

describe("tiles.extract idempotence", () => {
  test("a ready region is not extracted again", async () => {
    const { db, worker } = setup();
    seed(db, {
      users: [{ id: "u", role: "member" }],
      locations: [{ id: "l1", ownerId: "u", lat: 51, lon: 7 }],
    });
    enqueueJob(db, ENSURE_JOB, { locationId: "l1" });
    await worker.drain();
    const before = regionRows(db)[0]!;
    enqueueJob(db, EXTRACT_JOB, { regionId: before.id });
    await worker.drain();
    expect(regionRows(db)[0]!.buildDate).toEqual(before.buildDate);
    expect(regionRows(db)[0]!.bytes).toBe(before.bytes);
  });
});
