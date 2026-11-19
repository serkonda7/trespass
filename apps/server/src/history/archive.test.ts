import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { type Job, sources } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createLocation } from "../locations/service";
import { type ArchiveFetch, handleArchiveSource, requestArchive } from "./archive";
import { createHistory, getHistory } from "./service";

const owner = ctxFor("owner", "member");
let db: AppDb;
let sourceId: string;
let historyId: string;

const job = (attempts: number) => ({ attempts }) as Job;
const run = (fetch: ArchiveFetch, attempts = 1) =>
  handleArchiveSource(
    { sourceId },
    { db, job: job(attempts), signal: new AbortController().signal },
    { fetch },
  );

beforeEach(() => {
  db = createTestDb();
  seed(db, { users: [{ id: "owner", role: "member" }] });
  const locationId = createLocation(db, owner, {
    name: "Zeche",
    categoryId: "cat-industry",
    point: { lat: 51.5, lon: 7.2 },
  }).id;
  historyId = createHistory(db, owner, {
    locationId,
    datePrecision: "year",
    dateFrom: "1890",
    text: "Abgeteuft",
    sources: [{ url: "https://example.org/zeche" }],
  }).id;
  sourceId = getHistory(db, owner, historyId).sources[0]!.id;
});

describe("archive.org copies", () => {
  test("the save answer's Content-Location becomes the archived URL", async () => {
    const calls: string[] = [];
    await run(async (url, init) => {
      calls.push(url);
      expect(init?.headers?.["User-Agent"]).toBe("trespass/0.1");
      return new Response("", {
        status: 200,
        headers: { "content-location": "/web/20261119120000/https://example.org/zeche" },
      });
    });
    expect(calls).toEqual(["https://web.archive.org/save/https://example.org/zeche"]);
    const src = getHistory(db, owner, historyId).sources[0]!;
    expect(src.archiveStatus).toBe("done");
    expect(src.archivedUrl).toBe(
      "https://web.archive.org/web/20261119120000/https://example.org/zeche",
    );
  });

  test("falls back to the closest snapshot", async () => {
    const url = await requestArchive("https://example.org/a", {
      fetch: async (u) =>
        u.startsWith("https://web.archive.org/save/")
          ? new Response("busy", { status: 429 })
          : Response.json({
              archived_snapshots: {
                closest: {
                  available: true,
                  url: "http://web.archive.org/web/20200101000000/https://example.org/a",
                },
              },
            }),
    });
    expect(url).toBe("https://web.archive.org/web/20200101000000/https://example.org/a");
  });

  test("retries, then marks the source failed on the last attempt", async () => {
    const failing: ArchiveFetch = async () => new Response("", { status: 503 });
    await expect(run(failing, 1)).rejects.toThrow();
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()!.archiveStatus).toBe(
      "pending",
    );
    await run(failing, 3);
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()!.archiveStatus).toBe(
      "failed",
    );
  });

  test("is idempotent once done", async () => {
    db.update(sources).set({ archiveStatus: "done" }).where(eq(sources.id, sourceId)).run();
    let called = false;
    await run(async () => {
      called = true;
      return new Response("");
    });
    expect(called).toBe(false);
  });
});
