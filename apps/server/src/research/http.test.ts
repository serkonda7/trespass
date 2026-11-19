import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppDb } from "../db/client";
import { createTestDb } from "../db/test-db";
import {
  blocklistFrom,
  checkUrl,
  createPoliteFetcher,
  FetchRefused,
  RESEARCH_USER_AGENT,
} from "./http";
import { wikidataDate } from "./wikidata";

const cacheDir = mkdtempSync(join(tmpdir(), "trespass-http-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));
let db: AppDb;
beforeEach(() => {
  db = createTestDb();
});

describe("checkUrl", () => {
  const list = blocklistFrom("forum.example, urbex.example");
  test("refuses private hosts, odd schemes and blocklisted hosts", () => {
    for (const bad of [
      "http://localhost/x",
      "http://10.0.0.1/",
      "http://192.168.1.2",
      "http://box.ts.net/",
      "file:///etc/passwd",
      "ftp://a.b/c",
      "http://user:pw@a.org/",
    ]) {
      expect(() => checkUrl(bad, list)).toThrow(FetchRefused);
    }
    expect(() => checkUrl("https://www.facebook.com/x", list)).toThrow("blocked");
    expect(() => checkUrl("https://sub.forum.example/x", list)).toThrow("blocked");
    expect(checkUrl("https://de.wikipedia.org/wiki/A#b", list).toString()).toBe(
      "https://de.wikipedia.org/wiki/A",
    );
  });
});

describe("polite fetcher", () => {
  test("waits between requests to one host, sends a generic UA and revalidates with ETag", async () => {
    let clock = 0;
    const waits: number[] = [];
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = createPoliteFetcher({
      db,
      cacheDir,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      hostIntervalMs: 5000,
      fetch: async (url, init) => {
        seen.push({ url, headers: init?.headers as Record<string, string> });
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        if ((init?.headers as Record<string, string> | undefined)?.["If-None-Match"] === '"a"')
          return new Response(null, { status: 304 });
        return new Response("<p>Hallo Welt</p>", {
          headers: { "content-type": "text/html", etag: '"a"' },
        });
      },
    });
    const first = await fetcher.page("https://example.org/a");
    expect(first.fromCache).toBe(false);
    expect(waits).toEqual([5000]); // robots.txt, then the page
    expect(seen.every((s) => s.headers["User-Agent"] === RESEARCH_USER_AGENT)).toBe(true);
    const cached = await fetcher.page("https://example.org/a");
    expect(cached).toMatchObject({ fromCache: true, body: "<p>Hallo Welt</p>" });
    clock += 8 * 86_400_000; // stale: revalidate
    const revalidated = await fetcher.page("https://example.org/a");
    expect(revalidated).toMatchObject({ fromCache: true, body: "<p>Hallo Welt</p>" });
    expect(seen.at(-1)!.headers["If-None-Match"]).toBe('"a"');
  });

  test("falls back to the Wayback Machine when the page is gone", async () => {
    const fetcher = createPoliteFetcher({
      db,
      cacheDir,
      hostIntervalMs: 0,
      fetch: async (url) => {
        if (url.endsWith("/robots.txt")) return new Response("");
        if (url.startsWith("https://archive.org/wayback/available"))
          return Response.json({
            archived_snapshots: {
              closest: { available: true, timestamp: "20200101000000", url: "x" },
            },
          });
        if (url.startsWith("https://web.archive.org/web/20200101000000id_/"))
          return new Response("old text", { headers: { "content-type": "text/plain" } });
        return new Response("gone", { status: 410 });
      },
    });
    const page = await fetcher.page("https://gone.example.org/story");
    expect(page.body).toBe("old text");
    expect(page.archivedUrl).toBe(
      "https://web.archive.org/web/20200101000000/https://gone.example.org/story",
    );
  });

  test("refuses non-text content", async () => {
    const fetcher = createPoliteFetcher({
      db,
      cacheDir,
      hostIntervalMs: 0,
      fetch: async (url) =>
        url.endsWith("/robots.txt")
          ? new Response("")
          : new Response("x", { headers: { "content-type": "application/pdf" } }),
    });
    await expect(fetcher.page("https://example.org/doc")).rejects.toThrow("type");
  });
});

describe("wikidataDate", () => {
  test("maps precisions", () => {
    expect(wikidataDate("1968-03-31T00:00:00Z", 11)).toEqual({
      dateFrom: "1968-03-31",
      datePrecision: "day",
    });
    expect(wikidataDate("1968-03-01T00:00:00Z", 10)).toEqual({
      dateFrom: "1968-03",
      datePrecision: "month",
    });
    expect(wikidataDate("1968-01-01T00:00:00Z", 9)).toEqual({
      dateFrom: "1968",
      datePrecision: "year",
    });
    expect(wikidataDate("1968-01-01T00:00:00Z", 8)).toEqual({
      dateFrom: "1960",
      datePrecision: "decade",
    });
    expect(wikidataDate("1968-01-01T00:00:00Z", 7)).toBeNull();
  });
});
