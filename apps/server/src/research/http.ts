// Polite HTTP for research (DESIGN §6.1): robots.txt is followed, one request
// per host every few seconds, responses are cached in `http_cache` (bodies on
// disk, revalidated with ETag / Last-Modified), the user agent is generic, and
// blocklisted or private hosts are never fetched. A page that cannot be read
// live falls back to its newest Wayback Machine copy. `fetch`, the clock and
// sleep are injectable, so tests never touch the network or wait.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { httpCache } from "../db/schema";
import { parseRobots, type RobotsRules, robotsAllows } from "./robots";

/** Generic, no personal or instance details. */
export const RESEARCH_USER_AGENT = "Mozilla/5.0 (compatible; ResearchBot/1.0)";
const ROBOTS_TOKEN = "researchbot";

/**
 * Never fetched: their terms forbid scraping or they need a login. Urbex
 * forums go here too (and via RESEARCH_BLOCKLIST), subdomains included.
 */
export const DEFAULT_BLOCKLIST = [
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "pinterest.com",
  "reddit.com",
  "linkedin.com",
  "flickr.com",
  "youtube.com",
] as const;

export const PAGE_MAX_BYTES = 3_000_000;
export const PAGE_MAX_AGE_MS = 7 * 86_400_000;
const TIMEOUT_MS = 20_000;
const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PoliteDeps = {
  db: DbOrTx;
  cacheDir: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between two requests to one host (default 5 s). */
  hostIntervalMs?: number;
  blocklist?: readonly string[];
  signal?: AbortSignal;
};

export class FetchRefused extends Error {
  constructor(public readonly reason: "blocked" | "robots" | "url" | "type" | "size" | "status") {
    super(`fetch refused: ${reason}`);
    this.name = "FetchRefused";
  }
}

export type FetchedPage = {
  url: string;
  status: number;
  contentType: string | null;
  body: string;
  fromCache: boolean;
  /** Set when the live page failed and a Wayback copy was read instead. */
  archivedUrl: string | null;
};

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|.*\.ts\.net|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[.*\])$/i;

/** Only public http(s) URLs on hosts that are not blocklisted. */
export function checkUrl(raw: string, blocklist: readonly string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchRefused("url");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) {
    throw new FetchRefused("url");
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || PRIVATE_HOST.test(host)) throw new FetchRefused("url");
  if (isBlocked(host, blocklist)) throw new FetchRefused("blocked");
  u.hash = "";
  return u;
}

export function isBlocked(host: string, blocklist: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return blocklist.some((b) => {
    const d = b.trim().toLowerCase();
    return d !== "" && (h === d || h.endsWith(`.${d}`));
  });
}

export function blocklistFrom(extra: string | undefined): string[] {
  return [
    ...DEFAULT_BLOCKLIST,
    ...(extra ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
}

const hashUrl = (url: string) => new Bun.CryptoHasher("sha256").update(url).digest("hex");

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new FetchRefused("size");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export type PoliteFetcher = ReturnType<typeof createPoliteFetcher>;

export function createPoliteFetcher(deps: PoliteDeps) {
  const doFetch = deps.fetch ?? (fetch as FetchLike);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const interval = deps.hostIntervalMs ?? 5_000;
  const blocklist = deps.blocklist ?? DEFAULT_BLOCKLIST;
  const lastByHost = new Map<string, number>();
  const robotsByHost = new Map<string, RobotsRules | "all" | "none">();
  let requests = 0;

  async function waitForHost(host: string) {
    const last = lastByHost.get(host);
    if (last !== undefined) {
      const wait = last + interval - now();
      if (wait > 0) await sleep(wait);
    }
    lastByHost.set(host, now());
  }

  async function request(url: URL, init: RequestInit = {}): Promise<Response> {
    deps.signal?.throwIfAborted();
    await waitForHost(url.host);
    requests++;
    const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(deps.signal ? [deps.signal] : [])];
    return doFetch(url.toString(), {
      ...init,
      headers: { "User-Agent": RESEARCH_USER_AGENT, ...(init.headers as Record<string, string>) },
      redirect: "follow",
      signal: AbortSignal.any(signals),
    });
  }

  async function robotsFor(u: URL): Promise<RobotsRules | "all" | "none"> {
    const cached = robotsByHost.get(u.origin);
    if (cached) return cached;
    let rules: RobotsRules | "all" | "none";
    try {
      const res = await request(new URL("/robots.txt", u.origin));
      if (res.ok) rules = parseRobots(await readLimited(res, 500_000), ROBOTS_TOKEN);
      else rules = res.status >= 500 ? "none" : "all";
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      rules = "none";
    }
    robotsByHost.set(u.origin, rules);
    return rules;
  }

  /**
   * An API call (Overpass, Wikidata, SearXNG, Wikipedia API): rate-limited
   * and with the generic UA, but neither cached nor checked against robots.
   */
  async function api(
    raw: string,
    init: { method?: "GET" | "POST"; body?: string; contentType?: string; accept?: string } = {},
  ): Promise<string> {
    const u = new URL(raw);
    const res = await request(u, {
      method: init.method ?? "GET",
      body: init.body,
      headers: {
        Accept: init.accept ?? "application/json",
        ...(init.contentType ? { "Content-Type": init.contentType } : {}),
      },
    });
    if (!res.ok) throw new Error(`${u.host} answered ${res.status}`);
    return readLimited(res, 20_000_000);
  }

  function cachedRow(url: string) {
    return deps.db
      .select()
      .from(httpCache)
      .where(eq(httpCache.urlHash, hashUrl(url)))
      .get();
  }

  async function readCachedBody(path: string | null): Promise<string | null> {
    if (!path) return null;
    const file = Bun.file(join(deps.cacheDir, path));
    return (await file.exists()) ? file.text() : null;
  }

  async function storeBody(url: string, res: Response, body: string) {
    const hash = hashUrl(url);
    const rel = join(hash.slice(0, 2), `${hash}.txt`);
    const abs = join(deps.cacheDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    await Bun.write(abs, body);
    const row = {
      urlHash: hash,
      url,
      status: res.status,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      contentType: res.headers.get("content-type"),
      fetchedAt: new Date(now()),
      bodyPath: rel,
    };
    deps.db
      .insert(httpCache)
      .values(row)
      .onConflictDoUpdate({ target: httpCache.urlHash, set: row })
      .run();
  }

  async function live(u: URL): Promise<FetchedPage> {
    const url = u.toString();
    const rules = await robotsFor(u);
    if (rules === "none" || (rules !== "all" && !robotsAllows(rules, u.pathname + u.search))) {
      throw new FetchRefused("robots");
    }
    const row = cachedRow(url);
    if (row && now() - row.fetchedAt.getTime() < PAGE_MAX_AGE_MS) {
      const body = await readCachedBody(row.bodyPath);
      if (body !== null)
        return {
          url,
          status: row.status,
          contentType: row.contentType,
          body,
          fromCache: true,
          archivedUrl: null,
        };
    }
    const headers: Record<string, string> = {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
    };
    if (row?.etag) headers["If-None-Match"] = row.etag;
    if (row?.lastModified) headers["If-Modified-Since"] = row.lastModified;
    const res = await request(u, { headers });
    if (res.status === 304 && row) {
      const body = await readCachedBody(row.bodyPath);
      if (body !== null) {
        deps.db
          .update(httpCache)
          .set({ fetchedAt: new Date(now()) })
          .where(eq(httpCache.urlHash, row.urlHash))
          .run();
        return {
          url,
          status: row.status,
          contentType: row.contentType,
          body,
          fromCache: true,
          archivedUrl: null,
        };
      }
    }
    if (!res.ok) throw new FetchRefused("status");
    // A redirect may have left the allowed hosts.
    if (res.url) checkUrl(res.url, blocklist);
    const type = res.headers.get("content-type");
    if (type && !TEXT_TYPES.test(type)) throw new FetchRefused("type");
    const body = await readLimited(res, PAGE_MAX_BYTES);
    await storeBody(url, res, body);
    return {
      url,
      status: res.status,
      contentType: type,
      body,
      fromCache: false,
      archivedUrl: null,
    };
  }

  async function fromArchive(u: URL): Promise<FetchedPage | null> {
    const lookup = await api(
      `https://archive.org/wayback/available?url=${encodeURIComponent(u.toString())}`,
    );
    const closest = (
      JSON.parse(lookup) as {
        archived_snapshots?: {
          closest?: { url?: string; available?: boolean; timestamp?: string };
        };
      }
    ).archived_snapshots?.closest;
    if (!closest?.available || !closest.timestamp) return null;
    // `id_` returns the original bytes without the Wayback toolbar.
    const raw = `https://web.archive.org/web/${closest.timestamp}id_/${u.toString()}`;
    const res = await request(new URL(raw));
    if (!res.ok) return null;
    const type = res.headers.get("content-type");
    if (type && !TEXT_TYPES.test(type)) return null;
    const body = await readLimited(res, PAGE_MAX_BYTES);
    return {
      url: u.toString(),
      status: res.status,
      contentType: type,
      body,
      fromCache: false,
      archivedUrl: `https://web.archive.org/web/${closest.timestamp}/${u.toString()}`,
    };
  }

  /** A web page: robots, cache, then the Wayback fallback when the live fetch fails. */
  async function page(raw: string): Promise<FetchedPage> {
    const u = checkUrl(raw, blocklist);
    try {
      return await live(u);
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      // Robots, blocklist and type refusals are final; network errors and
      // HTTP failures may still be readable from the archive.
      if (err instanceof FetchRefused && err.reason !== "status") throw err;
      const archived = await fromArchive(u).catch(() => null);
      if (archived) return archived;
      throw err;
    }
  }

  return { api, page, requestCount: () => requests };
}
