// research_runs bookkeeping: one row per job run, with stats, cost and the
// outcome. Runs are created when a job is requested, claimed by the worker and
// finished with `done`, `failed`, `budget` or `skipped`.
import type {
  ResearchRunDto,
  ResearchRunKind,
  ResearchRunStats,
} from "@trespass/shared/research/types";
import { desc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { locations, type ResearchRunRow, researchRuns, searchAreas } from "../db/schema";

export function createRun(
  db: DbOrTx,
  o: {
    kind: ResearchRunKind;
    areaId?: string | null;
    locationId?: string | null;
    createdBy?: string | null;
  },
): string {
  return db
    .insert(researchRuns)
    .values({
      kind: o.kind,
      areaId: o.areaId ?? null,
      locationId: o.locationId ?? null,
      createdBy: o.createdBy ?? null,
    })
    .returning({ id: researchRuns.id })
    .get().id;
}

/** Claims a pending run (or one left `running` by a crashed worker). */
export function startRun(db: DbOrTx, runId: string): ResearchRunRow | null {
  const row = db.select().from(researchRuns).where(eq(researchRuns.id, runId)).get();
  if (!row || (row.status !== "pending" && row.status !== "running")) return null;
  return (
    db
      .update(researchRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(researchRuns.id, runId))
      .returning()
      .get() ?? null
  );
}

export function finishRun(
  db: DbOrTx,
  runId: string,
  o: {
    status: "done" | "failed" | "budget" | "skipped";
    stats: ResearchRunStats;
    error?: string | null;
    summary?: string | null;
  },
) {
  db.update(researchRuns)
    .set({
      status: o.status,
      stats: o.stats,
      error: o.error ?? null,
      ...(o.summary !== undefined ? { summary: o.summary } : {}),
      finishedAt: new Date(),
    })
    .where(eq(researchRuns.id, runId))
    .run();
}

export function saveRunStats(db: DbOrTx, runId: string, stats: ResearchRunStats) {
  db.update(researchRuns).set({ stats }).where(eq(researchRuns.id, runId)).run();
}

export function listRuns(db: DbOrTx, limit = 50): ResearchRunDto[] {
  const rows = db
    .select()
    .from(researchRuns)
    .orderBy(desc(researchRuns.createdAt), desc(researchRuns.id))
    .limit(limit)
    .all();
  const areaIds = [...new Set(rows.map((r) => r.areaId).filter((v): v is string => !!v))];
  const locationIds = [...new Set(rows.map((r) => r.locationId).filter((v): v is string => !!v))];
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
  const locs = new Map(
    locationIds.length
      ? db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, locationIds))
          .all()
          .map((l) => [l.id, l])
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    area: r.areaId ? (areas.get(r.areaId) ?? null) : null,
    location: r.locationId ? (locs.get(r.locationId) ?? null) : null,
    stats: r.stats ?? {},
    summary: r.summary,
    error: r.error,
    costCents: Math.round(r.costCents * 1000) / 1000,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
