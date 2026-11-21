// Research inbox (DESIGN §6.4), the only output of research. Nothing changes
// until the admin decides (see DecideCandidateInput for the options).
// Rejected rows are kept, never suggested again. New locations go through
// createLocation (tile region + search index).
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { haversineMeters } from "@trespass/shared/geo/distance";
import type { Point } from "@trespass/shared/geo/types";
import {
  CANDIDATE_PAGE_SIZE,
  type DecideCandidateInput,
  decideCandidateInput,
  type ListCandidatesInput,
  listCandidatesInput,
  startEnrichInput,
  startScanInput,
} from "@trespass/shared/research/inputs";
import { factText } from "@trespass/shared/research/text";
import type {
  CandidateDto,
  CandidateList,
  CandidateLocationRef,
  CandidateStatus,
  Evidence,
  FactPayload,
  NewLocationPayload,
  ResearchOverview,
  StatusChangePayload,
} from "@trespass/shared/research/types";
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { recordEvent } from "../audit";
import {
  loadLocationForCtx,
  visibleLatExpr,
  visibleLocationsWhere,
  visibleLonExpr,
} from "../authz";
import type { AppDb, DbOrTx } from "../db/client";
import {
  type CandidateRow,
  candidates,
  categories,
  history,
  locations,
  researchRuns,
  searchAreas,
} from "../db/schema";
import { AppError, appInvalid, appNotFound, parseAppInput } from "../errors";
import { createHistory } from "../history/service";
import { enqueueJob } from "../jobs/queue";
import { createLocation, updateLocation } from "../locations/service";
import { requireArea, requireResearch } from "./areas";
import { researchBudget } from "./budget";
import { ENRICH_JOB, OVERPASS_JOB, WIKIDATA_JOB } from "./kinds";
import { createRun, listRuns } from "./runs";

const asDb = (db: DbOrTx) => db as unknown as AppDb;
const NEARBY_M = 5_000;
const notFound = () => appNotFound("CANDIDATE_NOT_FOUND");

// --- Listing -------------------------------------------------------------------

/** Visible locations near a point, with the caller's visible coordinates (exact for the admin). */
function nearbyLocations(
  db: AppDb,
  ctx: AuthCtx,
  point: Point,
  limit: number,
): CandidateLocationRef[] {
  const dLat = NEARBY_M / 111_320;
  const dLon = NEARBY_M / (111_320 * Math.max(0.01, Math.cos((point.lat * Math.PI) / 180)));
  const latExpr = visibleLatExpr(ctx);
  const lonExpr = visibleLonExpr(ctx);
  const rows = db
    .select({
      id: locations.id,
      name: locations.name,
      lat: sql<number>`${latExpr}`.as("visible_lat"),
      lon: sql<number>`${lonExpr}`.as("visible_lon"),
    })
    .from(locations)
    .where(
      and(
        visibleLocationsWhere(ctx),
        sql`${latExpr} between ${point.lat - dLat} and ${point.lat + dLat}`,
        sql`${lonExpr} between ${point.lon - dLon} and ${point.lon + dLon}`,
      ),
    )
    .limit(200)
    .all();
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      point: { lat: r.lat, lon: r.lon },
      distanceM: Math.round(haversineMeters(point, r)),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

function locationRefs(
  db: AppDb,
  ctx: AuthCtx,
  ids: string[],
): Map<string, { id: string; name: string; point: Point }> {
  if (ids.length === 0) return new Map();
  const latExpr = visibleLatExpr(ctx);
  const lonExpr = visibleLonExpr(ctx);
  return new Map(
    db
      .select({
        id: locations.id,
        name: locations.name,
        lat: sql<number>`${latExpr}`.as("visible_lat"),
        lon: sql<number>`${lonExpr}`.as("visible_lon"),
      })
      .from(locations)
      .where(and(visibleLocationsWhere(ctx), inArray(locations.id, ids)))
      .all()
      .map((r) => [r.id, { id: r.id, name: r.name, point: { lat: r.lat, lon: r.lon } }]),
  );
}

function parseCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  const [at, id] = cursor.split(":");
  const n = Number(at);
  if (!id || !Number.isSafeInteger(n)) throw appInvalid("CURSOR_INVALID");
  return { at: n, id };
}

export function listCandidates(db: AppDb, ctx: AuthCtx, raw: ListCandidatesInput): CandidateList {
  requireResearch(ctx);
  const input = parseAppInput(listCandidatesInput, raw);
  const cursor = parseCursor(input.cursor);
  const filters: SQL[] = [eq(candidates.status, input.status)];
  if (input.kind) filters.push(eq(candidates.kind, input.kind));
  if (input.areaId) filters.push(eq(candidates.areaId, input.areaId));
  if (input.locationId) filters.push(eq(candidates.locationId, input.locationId));
  if (cursor) {
    const at = new Date(cursor.at);
    filters.push(
      or(
        lt(candidates.createdAt, at),
        and(eq(candidates.createdAt, at), lt(candidates.id, cursor.id)),
      ) as SQL,
    );
  }
  const rows = db
    .select()
    .from(candidates)
    .where(and(...filters))
    .orderBy(desc(candidates.createdAt), desc(candidates.id))
    .limit(CANDIDATE_PAGE_SIZE + 1)
    .all();
  const page = rows.slice(0, CANDIDATE_PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > CANDIDATE_PAGE_SIZE && last ? `${last.createdAt.getTime()}:${last.id}` : null;

  const locIds = [
    ...new Set(
      page.flatMap((r) => [r.locationId, r.resultLocationId]).filter((v): v is string => !!v),
    ),
  ];
  const refs = locationRefs(db, ctx, locIds);
  const areaIds = [...new Set(page.map((r) => r.areaId).filter((v): v is string => !!v))];
  const areas = new Map(
    areaIds.length
      ? db
          .select({ id: searchAreas.id, name: searchAreas.name })
          .from(searchAreas)
          .where(inArray(searchAreas.id, areaIds))
          .all()
          .map((a) => [a.id, a])
      : [],
  );
  const runIds = [...new Set(page.map((r) => r.runId).filter((v): v is string => !!v))];
  const runs = new Map(
    runIds.length
      ? db
          .select({ id: researchRuns.id, kind: researchRuns.kind })
          .from(researchRuns)
          .where(inArray(researchRuns.id, runIds))
          .all()
          .map((r) => [r.id, r])
      : [],
  );

  const items: CandidateDto[] = page.map((r) => {
    const point = r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null;
    const subject = r.locationId ? refs.get(r.locationId) : undefined;
    const result = r.resultLocationId ? refs.get(r.resultLocationId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      name: r.name,
      point,
      payload: r.payload,
      evidence: r.evidence ?? [],
      confidence: r.confidence,
      location: subject ? { ...subject, distanceM: null } : null,
      resultLocation: result ? { id: result.id, name: result.name } : null,
      nearby:
        r.kind === "new_location" && r.status === "inbox" && point
          ? nearbyLocations(db, ctx, point, 5)
          : [],
      area: r.areaId ? (areas.get(r.areaId) ?? null) : null,
      run: r.runId ? (runs.get(r.runId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  });

  const countRows = db
    .select({ status: candidates.status, n: sql<number>`count(*)` })
    .from(candidates)
    .groupBy(candidates.status)
    .all();
  const counts = { inbox: 0, accepted: 0, merged: 0, rejected: 0 } as Record<
    CandidateStatus,
    number
  >;
  for (const c of countRows) counts[c.status] = Number(c.n);
  return { items, nextCursor, counts };
}

// --- Requests ------------------------------------------------------------------

export function requestScan(
  db: AppDb,
  ctx: AuthCtx,
  raw: z.input<typeof startScanInput>,
): { runId: string } {
  const input = parseAppInput(startScanInput, raw);
  const area = requireArea(db, ctx, input.areaId);
  return db.transaction((tx) => {
    const runId = createRun(tx, { kind: input.kind, areaId: area.id, createdBy: ctx.userId });
    enqueueJob(tx, input.kind === "scan.overpass" ? OVERPASS_JOB : WIKIDATA_JOB, { runId });
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: runId,
      action: "research.run_requested",
      diff: { runId, kind: input.kind, areaId: area.id },
    });
    return { runId };
  });
}

export function requestEnrich(
  db: AppDb,
  ctx: AuthCtx,
  raw: z.input<typeof startEnrichInput>,
): { runId: string } {
  requireResearch(ctx);
  const input = parseAppInput(startEnrichInput, raw);
  if (!loadLocationForCtx(db, ctx, input.locationId)) throw appNotFound("LOCATION_NOT_FOUND");
  return db.transaction((tx) => {
    const runId = createRun(tx, {
      kind: "enrich",
      locationId: input.locationId,
      createdBy: ctx.userId,
    });
    enqueueJob(tx, ENRICH_JOB, { runId });
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: runId,
      action: "research.run_requested",
      diff: { runId, kind: "enrich", locationId: input.locationId },
    });
    return { runId };
  });
}

export function researchOverview(db: AppDb, ctx: AuthCtx): ResearchOverview {
  requireResearch(ctx);
  return { runs: listRuns(db), budget: researchBudget(db) };
}

// --- Decisions -------------------------------------------------------------------

function sourcesFrom(evidence: readonly Evidence[]) {
  // Only web pages and records with a real URL become sources; OSM tags and
  // Wikidata statements keep their quote as the excerpt.
  return evidence.slice(0, 20).map((e) => ({
    url: e.url,
    title: e.title ? e.title.slice(0, 300) : null,
    excerpt: e.quote ? e.quote.slice(0, 2000) : null,
  }));
}

function addFactHistory(
  tx: DbOrTx,
  ctx: AuthCtx,
  locationId: string,
  candidateId: string,
  fact: FactPayload,
  evidence: readonly Evidence[],
) {
  const { id } = createHistory(asDb(tx), ctx, {
    locationId,
    datePrecision: fact.datePrecision,
    dateFrom: fact.dateFrom,
    dateTo: fact.dateTo ?? null,
    text: factText(fact),
    status: "approved",
    sources: sourcesFrom(evidence),
  });
  tx.update(history).set({ candidateId }).where(eq(history.id, id)).run();
  return id;
}

function categoryIdFor(tx: DbOrTx, key: string, override?: string): string {
  if (override) return override;
  const row =
    tx.select({ id: categories.id }).from(categories).where(eq(categories.key, key)).get() ??
    tx.select({ id: categories.id }).from(categories).where(eq(categories.key, "other")).get();
  if (!row) throw appInvalid("CATEGORY_INVALID");
  return row.id;
}

function markDecided(
  tx: DbOrTx,
  ctx: AuthCtx,
  row: CandidateRow,
  status: Exclude<CandidateStatus, "inbox">,
  resultLocationId?: string | null,
) {
  const r = tx
    .update(candidates)
    .set({
      status,
      decidedBy: ctx.userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
      ...(resultLocationId !== undefined ? { resultLocationId } : {}),
    })
    .where(and(eq(candidates.id, row.id), eq(candidates.status, "inbox")))
    .run() as unknown as { changes: number };
  if (r.changes !== 1) throw new AppError(409, "CANDIDATE_DECIDED");
}

export type DecideResult = {
  status: Exclude<CandidateStatus, "inbox">;
  locationId: string | null;
  historyId: string | null;
};

export function decideCandidate(db: AppDb, ctx: AuthCtx, raw: DecideCandidateInput): DecideResult {
  requireResearch(ctx);
  const input = parseAppInput(decideCandidateInput, raw);
  return db.transaction((tx) => {
    const row = tx.select().from(candidates).where(eq(candidates.id, input.id)).get();
    if (!row) throw notFound();
    if (row.status !== "inbox") throw new AppError(409, "CANDIDATE_DECIDED");
    const invalid = () => appInvalid("CANDIDATE_DECISION_INVALID");
    let result: DecideResult;

    if (input.decision === "reject") {
      markDecided(tx, ctx, row, "rejected");
      result = { status: "rejected", locationId: null, historyId: null };
    } else if (row.kind === "new_location") {
      const payload = row.payload as NewLocationPayload;
      if (row.lat === null || row.lon === null) throw invalid();
      const name = input.name ?? row.name;
      if (input.decision !== "merge" && !name) throw invalid();
      const facts = input.fact ? [input.fact] : (payload.facts ?? []);
      let locationId: string;
      if (input.decision === "merge") {
        if (!input.targetLocationId) throw invalid();
        const target = loadLocationForCtx(asDb(tx), ctx, input.targetLocationId);
        if (!target) throw appNotFound("LOCATION_NOT_FOUND");
        locationId = target.location.id;
      } else if (input.decision === "accept" || input.decision === "later") {
        locationId = createLocation(asDb(tx), ctx, {
          name: name as string,
          categoryId: categoryIdFor(tx, payload.categoryKey, input.categoryId),
          description:
            input.description !== undefined ? input.description : (payload.description ?? null),
          status: input.decision === "accept" ? "researched" : "idea",
          point: { lat: row.lat, lon: row.lon },
        }).id;
      } else throw invalid();
      let historyId: string | null = null;
      for (const f of facts)
        historyId = addFactHistory(tx, ctx, locationId, row.id, f, row.evidence ?? []);
      const status = input.decision === "merge" ? "merged" : "accepted";
      markDecided(tx, ctx, row, status, locationId);
      result = { status, locationId, historyId };
    } else if (row.kind === "fact") {
      if (input.decision !== "accept" || !row.locationId) throw invalid();
      const fact = input.fact ?? (row.payload as FactPayload);
      const historyId = addFactHistory(tx, ctx, row.locationId, row.id, fact, row.evidence ?? []);
      markDecided(tx, ctx, row, "accepted");
      result = { status: "accepted", locationId: row.locationId, historyId };
    } else {
      if (input.decision !== "accept" || !row.locationId) throw invalid();
      const found = loadLocationForCtx(asDb(tx), ctx, row.locationId);
      if (!found) throw appNotFound("LOCATION_NOT_FOUND");
      const { status } = row.payload as StatusChangePayload;
      updateLocation(asDb(tx), ctx, {
        id: found.location.id,
        version: found.location.version,
        status,
      });
      markDecided(tx, ctx, row, "accepted");
      result = { status: "accepted", locationId: found.location.id, historyId: null };
    }
    // Ids and the decision only: no names, quotes or coordinates.
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "research.candidate_decided",
      diff: {
        candidateId: row.id,
        kind: row.kind,
        decision: input.decision,
        locationId: result.locationId,
      },
    });
    return result;
  });
}
