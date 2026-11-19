// Export under load and misuse: per-user/global limits, tickets, client
// disconnects and idle consumers, backpressure, and a consistent snapshot
// under concurrent writes. Sizes are small to keep the test fast.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { type AppDb, openDatabase } from "../db/client";
import { events, locations, photos as photosTable, users } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { PhotoStore } from "../photos/storage";
import { tempPhotoStore } from "../photos/test-helpers";
import { PATHS, writeExport } from "./build";
import { handleExportRequest } from "./handler";
import { createExportRegistry } from "./registry";
import { createProducerStream } from "./stream";
import { readArchive } from "./test-helpers";

const photos = tempPhotoStore();
afterAll(() => photos.cleanup());
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const req = (q = "") => new Request(`http://x/api/v1/export${q}`);

const admin = ctxFor("adm", "admin");
const m1 = ctxFor("m1", "member");
const m2 = ctxFor("m2", "member");
const guest = ctxFor("gu", "guest");

async function smallWorld(db: AppDb): Promise<PhotoStore> {
  seed(db, {
    users: [
      { id: "adm", role: "admin" },
      { id: "m1", role: "member" },
      { id: "m2", role: "member" },
      { id: "gu", role: "guest" },
    ],
    locations: Array.from({ length: 40 }, (_, i) => ({
      id: `loc${String(i).padStart(2, "0")}`,
      ownerId: "adm",
      name: `Ort ${i}`,
      visibility: "friends" as const,
      friendsLevel: "view" as const,
      lat: 50 + i / 100,
      lon: 7 + i / 100,
      pubLat: 51 + i / 100,
      pubLon: 8 + i / 100,
    })),
  });
  const body = crypto.getRandomValues(new Uint8Array(2 * 1024 * 1024));
  const { sha256 } = await photos.store.put(body);
  photos.store.ensureBlobSync(sha256, body);
  await photos.store.putDerived(sha256, 2560, body.subarray(0, 1024));
  db.insert(photosTable)
    .values({
      id: "ph-big",
      sha256,
      uploaderId: "adm",
      mime: "image/jpeg",
      bytes: body.length,
      status: "ready",
      locationId: "loc00",
    })
    .run();
  return photos.store;
}

const auditRows = (db: AppDb) =>
  db.select().from(events).where(eq(events.action, "export.created")).all() as {
    actorId: string;
    diff: Record<string, unknown>;
  }[];

describe("limits and disconnects", () => {
  test("one export per user, two overall; a cancelled download frees its slot", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const registry = createExportRegistry({ maxGlobal: 2 });
    const r1 = await handleExportRequest(db, m1, store, req(), { registry });
    expect(r1.status).toBe(200);
    const r2 = await handleExportRequest(db, m1, store, req(), { registry });
    expect(r2.status).toBe(429);
    expect(await r2.json()).toEqual({ error: "EXPORT_BUSY" });
    const r3 = await handleExportRequest(db, m2, store, req(), { registry });
    expect(r3.status).toBe(200);
    const r4 = await handleExportRequest(db, admin, store, req(), { registry });
    expect(r4.status).toBe(429);
    expect(await r4.json()).toEqual({ error: "EXPORT_LIMIT" });

    const reader = (r1.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await tick(20);
    expect(registry.status("m1").active).toBeNull();
    expect(registry.status("m1").last).toMatchObject({ completed: false });
    const audit = auditRows(db).find((e) => e.actorId === "m1");
    expect(audit?.diff).toMatchObject({ counts: {} });

    await (await handleExportRequest(db, admin, store, req(), { registry })).arrayBuffer();
    await (r3.body as ReadableStream).cancel();
    await tick(20);
    expect(registry.activeCount).toBe(0);
  });

  test("an aborted request signal ends the export", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const registry = createExportRegistry({ maxGlobal: 2 });
    const ac = new AbortController();
    const request = new Request("http://x/api/v1/export", { signal: ac.signal });
    const res = await handleExportRequest(db, m1, store, request, { registry });
    await tick(10);
    ac.abort();
    await tick(20);
    expect(registry.activeCount).toBe(0);
    expect(res.status).toBe(200);
  });

  test("a consumer that stops reading is cut off after the idle timeout", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const registry = createExportRegistry({ maxGlobal: 2 });
    const res = await handleExportRequest(db, m1, store, req(), {
      registry,
      idleTimeoutMs: 50,
    });
    expect(registry.activeCount).toBe(1);
    await tick(200);
    expect(registry.activeCount).toBe(0);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  test("tickets are claimed once, by their user", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const registry = createExportRegistry({ maxGlobal: 2, ticketTtlMs: 50 });
    const r = registry.reserve("m1");
    if (typeof r === "string") throw new Error(r);
    expect(registry.reserve("m1")).toBe("EXPORT_BUSY");
    expect(
      (await handleExportRequest(db, m1, store, req("?ticket=nope"), { registry })).status,
    ).toBe(409);
    expect(
      (await handleExportRequest(db, m2, store, req(`?ticket=${r.ticket}`), { registry })).status,
    ).toBe(409);
    const ok = await handleExportRequest(db, m1, store, req(`?ticket=${r.ticket}`), { registry });
    expect(ok.status).toBe(200);
    expect(
      (await handleExportRequest(db, m1, store, req(`?ticket=${r.ticket}`), { registry })).status,
    ).toBe(409);
    readArchive(new Uint8Array(await ok.arrayBuffer()));
    expect(registry.status("m1").last).toMatchObject({ completed: true });
  });

  test("guests get 404", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const res = await handleExportRequest(db, guest, store, req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });
});

describe("snapshot and backpressure", () => {
  test("writes during an export do not show up in it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trespass-export-snap-"));
    const db = openDatabase(join(dir, "app.sqlite"));
    try {
      const store = await smallWorld(db);
      const stream = createProducerStream((w) =>
        writeExport(w, { db, ctx: admin, store, pageSize: 5 }).then(() => {}),
      );
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      const first = await reader.read();
      if (first.value) chunks.push(first.value);
      db.update(locations).set({ name: "Umbenannt" }).run();
      db.insert(users)
        .values({
          id: "late",
          username: "late",
          displayName: "Late",
          authEmail: "late@users.invalid",
          role: "member",
        })
        .run();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const a = readArchive(new Uint8Array(Buffer.concat(chunks)));
      const list = a.json<{ name: string }[]>(PATHS.locations);
      expect(list).toHaveLength(40);
      expect(list.some((l) => l.name === "Umbenannt")).toBe(false);
      expect(a.json("manifest.json").snapshot).toBe(true);
      const cp = db.$client.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number };
      expect(cp.busy).toBe(0);
    } finally {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the producer waits for a slow reader and stays consistent", async () => {
    const db = createTestDb();
    const store = await smallWorld(db);
    const stream = createProducerStream(
      (w) => writeExport(w, { db, ctx: admin, store, pageSize: 3 }).then(() => {}),
      { highWaterMark: 1 },
    );
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let reads = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      reads++;
      await tick();
    }
    expect(reads).toBeGreaterThan(3);
    const a = readArchive(new Uint8Array(Buffer.concat(chunks)));
    expect(a.json(PATHS.manifest).formatVersion).toBe(1);
  });
});
