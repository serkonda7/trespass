import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { PHOTO_SIZES } from "../../lib/photos/types";
import { ctxFor, seed } from "../authz/test-fixtures";
import { photos } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { enqueueJob } from "../jobs/queue";
import { createJobRegistry, createJobWorker } from "../jobs/worker";
import { enqueueBlobGc, GC_JOB } from "./gc";
import { addPhotoJobs, PROCESS_JOB } from "./jobs";
import { insertPhoto, jpegFixture, tempPhotoStore } from "./test-helpers";

const OWNER = "photo-owner";
const LOC = "photo-location";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function setup(gps: { lat: number; lon: number } | null = { lat: 51.12345, lon: 7.12345 }) {
  const db = createTestDb();
  seed(db, {
    users: [{ id: OWNER, role: "member" }],
    locations: [
      {
        id: LOC,
        ownerId: OWNER,
        lat: 51.12345,
        lon: 7.12345,
        pubLat: 51.12345,
        pubLon: 7.12345,
        tz: "Etc/UTC",
      },
    ],
  });
  const t = tempPhotoStore();
  cleanup = t.cleanup;
  const registry = createJobRegistry();
  addPhotoJobs(registry, () => t.store);
  const worker = createJobWorker({ db, registry });
  return { db, store: t.store, registry, worker, gps, ctx: ctxFor(OWNER, "member") };
}

describe("photos.process job", () => {
  test("extracts EXIF, builds all derivatives, then suggests the location", async () => {
    const gps = { lat: 51.12345, lon: 7.12345 };
    const { db, store, worker } = setup(gps);
    const bytes = await jpegFixture({ gps });
    const { sha256 } = await store.put(bytes);
    const row = insertPhoto(db, {
      uploaderId: OWNER,
      locationId: LOC,
      sha256,
      status: "processing",
      bytes: bytes.byteLength,
    });
    enqueueJob(db, PROCESS_JOB, { photoId: row.id });
    expect(await worker.drain()).toBe(1);

    const done = db.select().from(photos).where(eq(photos.id, row.id)).get()!;
    expect(done.status).toBe("ready");
    expect(done.gpsLat).toBeGreaterThan(51);
    expect(done.exif.make).toBe("TestCam");
    expect(done.takenAt?.toISOString()).toContain("2026-11-18");
    expect(done.width).toBe(120);
    expect(done.height).toBe(80);
    for (const size of PHOTO_SIZES) expect(store.hasDerived(sha256, size)).toBe(true);
    // Already attached to a location: no suggestion is stored.
    expect(done.suggestedLocationId).toBeNull();

    // Idempotent: a crash re-enqueues the same job, nothing changes.
    enqueueJob(db, PROCESS_JOB, { photoId: row.id });
    expect(await worker.drain()).toBe(1);
    expect(db.select().from(photos).where(eq(photos.id, row.id)).get()!.status).toBe("ready");
  });

  test("GC removes a blob and derivatives only after the last row is gone", async () => {
    const { db, store, worker } = setup(null);
    const bytes = await jpegFixture({ gps: null, xmp: false });
    const { sha256 } = await store.put(bytes);
    const a = insertPhoto(db, { uploaderId: OWNER, sha256 });
    const b = insertPhoto(db, { uploaderId: OWNER, sha256 });
    enqueueJob(db, GC_JOB, { sha256 });
    await worker.drain();
    expect(store.hasBlob(sha256)).toBe(true); // b still references it

    db.delete(photos).where(eq(photos.id, a.id)).run();
    db.delete(photos).where(eq(photos.id, b.id)).run();
    enqueueBlobGc(db, [sha256]);
    await worker.drain();
    expect(store.hasBlob(sha256)).toBe(false);
    expect(store.hasAnyDerived(sha256)).toBe(false);
  });

  test("a failed missing original is marked failed instead of crashing the worker", async () => {
    const { db, worker } = setup(null);
    const row = insertPhoto(db, {
      uploaderId: OWNER,
      sha256: "c".repeat(64),
      status: "processing",
    });
    enqueueJob(db, PROCESS_JOB, { photoId: row.id });
    await worker.drain();
    expect(db.select().from(photos).where(eq(photos.id, row.id)).get()!.status).toBe("failed");
  });
});
