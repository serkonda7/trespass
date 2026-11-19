// Research jobs (DESIGN §6.3). All run in the standalone worker, are admin
// initiated (or the weekly `watch`), write only to `candidates` and
// `research_runs`, and never change a location. RESEARCH=off finishes every
// run as `skipped` without any outbound request.
//
//   scan.overpass / scan.wikidata  {runId}   search area → new_location (+ fact)
//   research.enrich                {runId}   location → Wikipedia + SearXNG → fetch → extract
//   research.watch                 {runId?}  weekly, in batches: news → status_change

import type { Ring } from "@trespass/shared/geo/polygon";
import { langForCountry } from "@trespass/shared/research/languages";
import type { Evidence, ResearchRunStats } from "@trespass/shared/research/types";
import { asc, eq, ne, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import {
  categories,
  locations,
  type ResearchRunRow,
  researchWatch,
  searchAreas,
} from "../db/schema";
import { getEnv } from "../env";
import { enqueueJob } from "../jobs/queue";
import { nextWeeklyInBerlin } from "../jobs/schedule";
import { addJobHandler, type JobContext, type JobRegistry } from "../jobs/worker";
import { BudgetExceeded } from "./budget";
import {
  extractFacts,
  type PlaceInput,
  queriesSchema,
  SUMMARY_SYSTEM,
  TRANSLATE_SYSTEM,
  type VerifiedFact,
} from "./extract";
import {
  blocklistFrom,
  createPoliteFetcher,
  type FetchLike,
  FetchRefused,
  type PoliteFetcher,
} from "./http";
import { createAnthropicLlm, type Llm, meteredLlm } from "./llm";
import { buildOverpassQuery, parseOverpass, SCAN_MAX_NEW } from "./overpass";
import { createRun, finishRun, saveRunStats, startRun } from "./runs";
import { addLocationFinding, addNewPlace } from "./store";
import { extractText } from "./text";
import { enrichQueries, type SearchHit, searxngHits, watchQuery, wikipediaHits } from "./websearch";
import { buildWikidataQuery, parseWikidata } from "./wikidata";

export const OVERPASS_JOB = "scan.overpass";
export const WIKIDATA_JOB = "scan.wikidata";
export const ENRICH_JOB = "research.enrich";
export const WATCH_JOB = "research.watch";

export const ENRICH_MAX_PAGES = 8;
export const WATCH_MAX_LOCATIONS = 15;
export const WATCH_BATCH = 5;
const MIN_TEXT_CHARS = 200;

export type ResearchDeps = {
  fetch?: FetchLike;
  /** Crawler cache directory (default CACHE_DIR). */
  cacheDir?: string;
  /** null: no LLM configured. Default: Claude when ANTHROPIC_API_KEY is set. */
  llm?: Llm | null;
  hostIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

class Skip extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

function fetcherFor(ctx: JobContext, deps: ResearchDeps): PoliteFetcher {
  const env = getEnv();
  return createPoliteFetcher({
    db: ctx.db,
    cacheDir: deps.cacheDir ?? env.CACHE_DIR,
    fetch: deps.fetch,
    sleep: deps.sleep,
    hostIntervalMs: deps.hostIntervalMs,
    blocklist: blocklistFrom(env.RESEARCH_BLOCKLIST),
    signal: ctx.signal,
  });
}

function llmFor(ctx: JobContext, runId: string, deps: ResearchDeps): Llm {
  const key = getEnv().ANTHROPIC_API_KEY;
  const inner = deps.llm === undefined ? (key ? createAnthropicLlm(key) : null) : deps.llm;
  if (!inner) throw new Skip("no_llm");
  return meteredLlm(ctx.db, runId, inner, deps.now);
}

type Body = (
  run: ResearchRunRow,
  stats: ResearchRunStats,
) => Promise<{ summary?: string | null; keepRunning?: boolean } | undefined>;

/** Claims the run, runs `body` and records the outcome. Job retries only follow a lost lease. */
async function executeRun(ctx: JobContext, runId: string, body: Body): Promise<void> {
  const run = startRun(ctx.db, runId);
  if (!run) return;
  const stats: ResearchRunStats = { ...(run.stats ?? {}) };
  if (getEnv().RESEARCH === "off") {
    finishRun(ctx.db, runId, { status: "skipped", stats: { ...stats, reason: "disabled" } });
    return;
  }
  try {
    const r = await body(run, stats);
    ctx.signal.throwIfAborted();
    if (r?.keepRunning) {
      saveRunStats(ctx.db, runId, stats);
      return;
    }
    finishRun(ctx.db, runId, { status: "done", stats, summary: r?.summary });
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      finishRun(ctx.db, runId, { status: "budget", stats });
    } else if (err instanceof Skip) {
      finishRun(ctx.db, runId, { status: "skipped", stats: { ...stats, reason: err.reason } });
    } else if (ctx.signal.aborted) {
      saveRunStats(ctx.db, runId, stats);
      throw err; // lease lost or shutdown: the worker runs it again
    } else {
      const message = err instanceof Error ? err.message : String(err);
      finishRun(ctx.db, runId, { status: "failed", stats, error: message.slice(0, 300) });
    }
  }
}

const runIdOf = (payload: unknown): string | null => {
  const id = (payload as { runId?: unknown } | null)?.runId;
  return typeof id === "string" ? id : null;
};

function areaRing(ctx: JobContext, run: ResearchRunRow) {
  if (!run.areaId) throw new Skip("area_missing");
  const area = ctx.db.select().from(searchAreas).where(eq(searchAreas.id, run.areaId)).get();
  if (!area) throw new Skip("area_missing");
  return { area, ring: area.geom.coordinates[0] as Ring };
}

// --- Scans ----------------------------------------------------------------------

export async function handleOverpassScan(
  payload: unknown,
  ctx: JobContext,
  deps: ResearchDeps = {},
) {
  const runId = runIdOf(payload);
  if (!runId) return;
  await executeRun(ctx, runId, async (run, stats) => {
    const { area, ring } = areaRing(ctx, run);
    const fetcher = fetcherFor(ctx, deps);
    const body = await fetcher.api(getEnv().OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(buildOverpassQuery(ring))}`,
      contentType: "application/x-www-form-urlencoded",
    });
    const places = parseOverpass(JSON.parse(body), ring);
    Object.assign(stats, { found: places.length, created: 0, duplicates: 0, known: 0 });
    for (const p of places) {
      if ((stats.created ?? 0) >= SCAN_MAX_NEW) break;
      const r = addNewPlace(ctx.db, {
        runId,
        areaId: area.id,
        name: p.name,
        point: p.point,
        sourceKey: p.sourceKey,
        payload: { categoryKey: p.categoryKey, tags: p.tags, osm: p.osm },
        evidence: [p.evidence],
        confidence: p.confidence,
      });
      if (r.result === "created") stats.created = (stats.created ?? 0) + 1;
      else if (r.result === "duplicate") stats.duplicates = (stats.duplicates ?? 0) + 1;
      else stats.known = (stats.known ?? 0) + 1;
    }
  });
}

export async function handleWikidataScan(
  payload: unknown,
  ctx: JobContext,
  deps: ResearchDeps = {},
) {
  const runId = runIdOf(payload);
  if (!runId) return;
  await executeRun(ctx, runId, async (run, stats) => {
    const { area, ring } = areaRing(ctx, run);
    const fetcher = fetcherFor(ctx, deps);
    const url = new URL(getEnv().WIKIDATA_SPARQL_URL);
    url.searchParams.set("query", buildWikidataQuery(ring, area.lang));
    url.searchParams.set("format", "json");
    const body = await fetcher.api(url.toString(), { accept: "application/sparql-results+json" });
    const places = parseWikidata(JSON.parse(body), ring);
    Object.assign(stats, { found: places.length, created: 0, duplicates: 0, known: 0, facts: 0 });
    for (const p of places) {
      if ((stats.created ?? 0) >= SCAN_MAX_NEW) break;
      const r = addNewPlace(ctx.db, {
        runId,
        areaId: area.id,
        name: p.name,
        point: p.point,
        sourceKey: p.sourceKey,
        payload: {
          categoryKey: p.categoryKey,
          description: p.description,
          wikidata: { id: p.qid, types: p.types },
          facts: p.closed ? [p.closed] : [],
        },
        evidence: [p.evidence],
        confidence: 0.7,
      });
      if (r.result === "created") stats.created = (stats.created ?? 0) + 1;
      else if (r.result === "duplicate") stats.duplicates = (stats.duplicates ?? 0) + 1;
      else {
        stats.known = (stats.known ?? 0) + 1;
        if (p.closed) {
          const f = addLocationFinding(ctx.db, {
            runId,
            locationId: r.locationId,
            sourceKey: `${p.sourceKey}:closed`,
            finding: { kind: "fact", payload: p.closed },
            evidence: [p.evidence],
            confidence: 0.7,
          });
          if (f.result === "created") stats.facts = (stats.facts ?? 0) + 1;
        }
      }
    }
  });
}

// --- Enrich and watch -------------------------------------------------------------

type LocationRow = {
  id: string;
  name: string;
  country: string | null;
  adminArea: string | null;
  categoryKey: string;
  categoryName: string;
};

function loadLocation(db: AppDb, id: string): LocationRow | null {
  return (
    db
      .select({
        id: locations.id,
        name: locations.name,
        country: locations.country,
        adminArea: locations.adminArea,
        categoryKey: categories.key,
        categoryName: categories.name,
      })
      .from(locations)
      .innerJoin(categories, eq(categories.id, locations.categoryId))
      .where(eq(locations.id, id))
      .get() ?? null
  );
}

const placeOf = (l: LocationRow) => [l.adminArea, l.country].filter(Boolean).join(", ") || null;

/** Translates German queries for a non-German area (cheap Haiku call), falling back to German. */
async function localQueries(
  llm: Llm,
  lang: string,
  queries: string[],
  signal: AbortSignal,
): Promise<string[]> {
  if (lang === "de") return queries;
  const r = await llm.json({
    system: TRANSLATE_SYSTEM,
    prompt: JSON.stringify({ language: lang, queries }),
    schema: queriesSchema,
    maxTokens: 1000,
    signal,
  });
  const out = (r.value?.queries ?? []).map((q) => q.trim()).filter((q) => q && q.length <= 300);
  return out.length ? [...new Set([...out, ...queries])] : queries;
}

const evidenceHash = (s: string) =>
  new Bun.CryptoHasher("sha256").update(s).digest("hex").slice(0, 24);

/** Fetch → text → extract for one page; stores verified findings. */
async function processPage(
  ctx: JobContext,
  o: {
    runId: string;
    llm: Llm;
    fetcher: PoliteFetcher;
    location: LocationRow;
    hit: SearchHit;
    mode: "all" | "status";
    stats: ResearchRunStats;
    collected: VerifiedFact[];
  },
) {
  const { stats } = o;
  let page: Awaited<ReturnType<PoliteFetcher["page"]>>;
  try {
    page = await o.fetcher.page(o.hit.url);
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    if (err instanceof FetchRefused) stats.refused = (stats.refused ?? 0) + 1;
    else stats.failedPages = (stats.failedPages ?? 0) + 1;
    return;
  }
  const text = extractText(page.body, page.contentType);
  if (text.text.length < MIN_TEXT_CHARS) return;
  stats.pages = (stats.pages ?? 0) + 1;
  const place: PlaceInput = {
    name: o.location.name,
    category: o.location.categoryName,
    place: placeOf(o.location),
  };
  const { facts, dropped } = await extractFacts(
    o.llm,
    place,
    { url: page.url, title: text.title ?? o.hit.title, text: text.text },
    o.mode,
    ctx.signal,
  );
  stats.dropped = (stats.dropped ?? 0) + dropped;
  for (const f of facts) {
    const evidence: Evidence = {
      url: page.url,
      title: text.title ?? o.hit.title,
      quote: f.quote,
      verified: true,
      source: "web",
      archivedUrl: page.archivedUrl,
    };
    const sourceKey = `web:${evidenceHash(`${page.url}\u0000${f.quote}`)}`;
    const r = addLocationFinding(ctx.db, {
      runId: o.runId,
      locationId: o.location.id,
      sourceKey,
      finding:
        f.kind === "history"
          ? { kind: "fact", payload: f.fact }
          : { kind: "status_change", payload: { status: f.status, reason: f.reason } },
      evidence: [evidence],
      confidence: f.confidence,
    });
    if (r.result === "created") stats.facts = (stats.facts ?? 0) + 1;
    o.collected.push(f);
  }
}

export async function handleEnrich(payload: unknown, ctx: JobContext, deps: ResearchDeps = {}) {
  const runId = runIdOf(payload);
  if (!runId) return;
  await executeRun(ctx, runId, async (run, stats) => {
    const location = run.locationId ? loadLocation(ctx.db, run.locationId) : null;
    if (!location) throw new Skip("location_missing");
    const llm = llmFor(ctx, runId, deps);
    const fetcher = fetcherFor(ctx, deps);
    const lang = langForCountry(location.country) ?? "de";
    // Wikipedia in the local language, German and English comes first.
    const hits: SearchHit[] = await wikipediaHits(fetcher, location.name, [lang, "de", "en"]);
    const searx = getEnv().SEARXNG_URL;
    if (searx) {
      const queries = await localQueries(
        llm,
        lang,
        enrichQueries(location.name, location.categoryKey, placeOf(location)),
        ctx.signal,
      );
      for (const q of queries) {
        if (hits.length >= ENRICH_MAX_PAGES * 2) break;
        hits.push(...(await searxngHits(fetcher, searx, q, { lang, limit: 4 }).catch(() => [])));
      }
    }
    const unique = [...new Map(hits.map((h) => [h.url, h])).values()].slice(0, ENRICH_MAX_PAGES);
    Object.assign(stats, { found: unique.length, pages: 0, facts: 0, dropped: 0 });
    const collected: VerifiedFact[] = [];
    for (const hit of unique) {
      await processPage(ctx, { runId, llm, fetcher, location, hit, mode: "all", stats, collected });
      saveRunStats(ctx.db, runId, stats);
    }
    if (collected.length === 0) return;
    const facts = collected.map((f) =>
      f.kind === "history" ? `${f.fact.dateFrom}: ${f.fact.text}` : `Aktuell: ${f.reason}`,
    );
    const summary = await llm.text({
      system: SUMMARY_SYSTEM,
      prompt: `Ort: ${location.name}\n\nGeprüfte Fakten:\n${facts.map((f) => `- ${f}`).join("\n")}`,
      signal: ctx.signal,
    });
    return { summary: summary.value?.slice(0, 4000) ?? null };
  });
}

/** Locations watch looks at next: not demolished, least recently checked first. */
function nextWatchLocations(db: AppDb, limit: number): LocationRow[] {
  const ids = db
    .select({ id: locations.id })
    .from(locations)
    .leftJoin(researchWatch, eq(researchWatch.locationId, locations.id))
    .where(ne(locations.status, "demolished"))
    .orderBy(
      sql`${researchWatch.checkedAt} IS NOT NULL`,
      asc(researchWatch.checkedAt),
      asc(locations.id),
    )
    .limit(limit)
    .all();
  return ids.map((r) => loadLocation(db, r.id)).filter((l): l is LocationRow => !!l);
}

export async function handleWatch(payload: unknown, ctx: JobContext, deps: ResearchDeps = {}) {
  let runId = runIdOf(payload);
  if (!runId) {
    // The weekly firing: only start a run when it can do something.
    const env = getEnv();
    const llmReady = deps.llm === undefined ? Boolean(env.ANTHROPIC_API_KEY) : deps.llm !== null;
    if (env.RESEARCH === "off" || !env.SEARXNG_URL || !llmReady) return;
    runId = createRun(ctx.db, { kind: "watch" });
  }
  await executeRun(ctx, runId, async (_run, stats) => {
    const searx = getEnv().SEARXNG_URL;
    if (!searx) throw new Skip("no_search");
    const llm = llmFor(ctx, runId, deps);
    const fetcher = fetcherFor(ctx, deps);
    const done = stats.locations ?? 0;
    const batch = nextWatchLocations(ctx.db, Math.min(WATCH_BATCH, WATCH_MAX_LOCATIONS - done));
    const translated = new Map<string, string>();
    for (const location of batch) {
      const lang = langForCountry(location.country) ?? "de";
      let query = watchQuery(location.name, placeOf(location));
      if (lang !== "de") {
        const key = `${lang}:${query}`;
        query =
          translated.get(key) ?? (await localQueries(llm, lang, [query], ctx.signal))[0] ?? query;
        translated.set(key, query);
      }
      const hits = await searxngHits(fetcher, searx, query, {
        lang,
        timeRange: "month",
        limit: 3,
      }).catch(() => []);
      for (const hit of hits) {
        await processPage(ctx, {
          runId,
          llm,
          fetcher,
          location,
          hit,
          mode: "status",
          stats,
          collected: [],
        });
      }
      ctx.db
        .insert(researchWatch)
        .values({ locationId: location.id, checkedAt: new Date() })
        .onConflictDoUpdate({ target: researchWatch.locationId, set: { checkedAt: new Date() } })
        .run();
      stats.locations = (stats.locations ?? 0) + 1;
      saveRunStats(ctx.db, runId, stats);
    }
    // More to do this week: continue in a fresh job so other jobs get a turn.
    if (batch.length === WATCH_BATCH && (stats.locations ?? 0) < WATCH_MAX_LOCATIONS) {
      enqueueJob(ctx.db, WATCH_JOB, { runId });
      return { keepRunning: true };
    }
  });
}

export function addResearchJobs(registry: JobRegistry, deps: ResearchDeps = {}) {
  // maxAttempts 2: only a lost lease or a crash re-runs a job; failures are
  // recorded on the run instead of being retried (and paid for) again.
  const opts = { maxAttempts: 2, backoffBaseMs: 60_000 };
  addJobHandler(registry, OVERPASS_JOB, (p, ctx) => handleOverpassScan(p, ctx, deps), {
    ...opts,
    timeoutMs: 600_000,
  });
  addJobHandler(registry, WIKIDATA_JOB, (p, ctx) => handleWikidataScan(p, ctx, deps), {
    ...opts,
    timeoutMs: 600_000,
  });
  addJobHandler(registry, ENRICH_JOB, (p, ctx) => handleEnrich(p, ctx, deps), {
    ...opts,
    timeoutMs: 1_800_000,
  });
  addJobHandler(registry, WATCH_JOB, (p, ctx) => handleWatch(p, ctx, deps), {
    ...opts,
    timeoutMs: 1_800_000,
    recurring: { next: (now) => nextWeeklyInBerlin(now, 1, 4) },
  });
}
