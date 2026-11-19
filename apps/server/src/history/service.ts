// History entries and their sources (DESIGN §5.4). Independent of the request;
// ./functions.ts adds authMiddleware. Visibility comes only from
// authz/history.ts (SQL); every write that changes approved text reindexes
// the location in the same transaction (the FTS `history` column).
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { isoDayInBerlin } from "@trespass/shared/format";
import {
  approveHistoryInput,
  type CreateHistoryInput,
  createHistoryInput,
  normalizeHistoryDate,
  type SourceInput,
  type UpdateHistoryInput,
  updateHistoryInput,
} from "@trespass/shared/history/inputs";
import type { SerializedHistory, SerializedSource } from "@trespass/shared/history/types";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { recordEvent } from "../audit";
import { canEditHistory, loadLocationForCtx, visibleHistoryWhere } from "../authz";
import type { Level } from "../authz/levels";
import type { AppDb, DbOrTx } from "../db/client";
import { type HistoryRow, history, type NewSource, sources, users } from "../db/schema";
import { appConflict, appForbidden, appNotFound, parseAppInput } from "../errors";
import { enqueueJob } from "../jobs/queue";
import { reindexLocations } from "../search/indexer";
import { archiveEnabled } from "./archive";

const asDb = (db: DbOrTx) => db as unknown as AppDb;
const notFound = () => appNotFound("HISTORY_NOT_FOUND");
const locationNotFound = () => appNotFound("LOCATION_NOT_FOUND");

function levelFor(db: DbOrTx, ctx: AuthCtx, locationId: string): Level {
  return loadLocationForCtx(asDb(db), ctx, locationId)?.level ?? "none";
}

/** One visible history row, or 404 (invisible drafts look exactly like missing rows). */
function requireRow(db: DbOrTx, ctx: AuthCtx, id: string): HistoryRow {
  const row = db
    .select()
    .from(history)
    .where(and(eq(history.id, id), visibleHistoryWhere(ctx, history)))
    .get();
  if (!row) throw notFound();
  return row;
}

/**
 * Replaces the sources of an entry. Kept sources (with `id`) keep their archive
 * copy unless the URL changed; new or changed URLs get a fresh archive request.
 */
function replaceSources(db: DbOrTx, historyId: string, list: readonly SourceInput[]) {
  const existing = new Map(
    db
      .select()
      .from(sources)
      .where(eq(sources.historyId, historyId))
      .all()
      .map((s) => [s.id, s]),
  );
  const keep = new Set<string>();
  list.forEach((input, sort) => {
    const old = input.id ? existing.get(input.id) : undefined;
    const fields = {
      url: input.url,
      title: input.title ?? null,
      retrievedOn: input.retrievedOn ?? old?.retrievedOn ?? isoDayInBerlin(),
      excerpt: input.excerpt ?? null,
      sort,
    };
    if (old && old.url === input.url) {
      keep.add(old.id);
      db.update(sources).set(fields).where(eq(sources.id, old.id)).run();
      return;
    }
    const values: NewSource = {
      historyId,
      ...fields,
      archiveStatus: archiveEnabled() ? "pending" : "skipped",
    };
    const row = db.insert(sources).values(values).returning({ id: sources.id }).get();
    keep.add(row.id);
    // Only the source URL goes to archive.org (in the worker), never location data.
    if (archiveEnabled()) enqueueJob(db, "sources.archive", { sourceId: row.id });
  });
  const drop = [...existing.keys()].filter((id) => !keep.has(id));
  if (drop.length) db.delete(sources).where(inArray(sources.id, drop)).run();
}

function serializeSources(db: DbOrTx, ids: readonly string[]): Map<string, SerializedSource[]> {
  const out = new Map<string, SerializedSource[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select()
    .from(sources)
    .where(inArray(sources.historyId, [...ids]))
    .orderBy(asc(sources.sort), asc(sources.createdAt))
    .all();
  for (const s of rows) {
    const dto: SerializedSource = {
      id: s.id,
      url: s.url,
      title: s.title,
      retrievedOn: s.retrievedOn,
      excerpt: s.excerpt,
      archivedUrl: s.archivedUrl,
      archiveStatus: s.archiveStatus,
    };
    const list = out.get(s.historyId);
    if (list) list.push(dto);
    else out.set(s.historyId, [dto]);
  }
  return out;
}

function serializeRows(
  db: DbOrTx,
  ctx: AuthCtx,
  rows: readonly HistoryRow[],
  level: Level,
): SerializedHistory[] {
  const srcs = serializeSources(
    db,
    rows.map((r) => r.id),
  );
  const authorIds = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const names = new Map(
    authorIds.length
      ? db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .where(inArray(users.id, authorIds))
          .all()
          .map((u) => [u.id, u.name])
      : [],
  );
  const editable = canEditHistory(ctx, level);
  return rows.map((r) => ({
    id: r.id,
    locationId: r.locationId,
    datePrecision: r.datePrecision,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    text: r.text,
    status: r.status,
    sources: srcs.get(r.id) ?? [],
    createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    permissions: {
      canEdit: editable,
      canDelete: editable,
      canApprove: editable && r.status === "draft",
    },
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// --- Read -------------------------------------------------------------------------

/** Entries of one visible location, oldest first. Drafts only for editors (in SQL). */
export function listHistory(db: AppDb, ctx: AuthCtx, locationId: string): SerializedHistory[] {
  const found = loadLocationForCtx(db, ctx, locationId, "view");
  if (!found) throw locationNotFound();
  const rows = db
    .select()
    .from(history)
    .where(and(eq(history.locationId, locationId), visibleHistoryWhere(ctx, history)))
    .orderBy(asc(history.dateFrom), asc(history.createdAt))
    .all();
  return serializeRows(db, ctx, rows, found.level);
}

export function getHistory(db: AppDb, ctx: AuthCtx, id: string): SerializedHistory {
  const row = requireRow(db, ctx, id);
  const [dto] = serializeRows(db, ctx, [row], levelFor(db, ctx, row.locationId));
  return dto!;
}

/**
 * Every visible entry, paged by id (export). Visibility stays in SQL; levels
 * only decide the permission flags.
 */
export function* historyPagesForExport(
  db: AppDb,
  ctx: AuthCtx,
  pageSize = 500,
): Generator<SerializedHistory[]> {
  let after = "";
  for (;;) {
    const rows = db
      .select()
      .from(history)
      .where(and(visibleHistoryWhere(ctx, history), after ? gt(history.id, after) : undefined))
      .orderBy(asc(history.id))
      .limit(pageSize)
      .all();
    if (rows.length === 0) return;
    after = rows[rows.length - 1]!.id;
    const out: SerializedHistory[] = [];
    for (const locationId of new Set(rows.map((r) => r.locationId))) {
      const level = levelFor(db, ctx, locationId);
      out.push(
        ...serializeRows(
          db,
          ctx,
          rows.filter((r) => r.locationId === locationId),
          level,
        ),
      );
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    yield out;
  }
}

// --- Write ------------------------------------------------------------------------

export function createHistory(
  db: AppDb,
  ctx: AuthCtx,
  raw: CreateHistoryInput,
): { id: string; version: number } {
  const input = parseAppInput(createHistoryInput, raw);
  return db.transaction((tx) => {
    const found = loadLocationForCtx(asDb(tx), ctx, input.locationId, "view");
    if (!found) throw locationNotFound();
    if (!canEditHistory(ctx, found.level)) throw appForbidden("HISTORY_FORBIDDEN");
    const row = tx
      .insert(history)
      .values({
        locationId: found.location.id,
        datePrecision: input.datePrecision,
        dateFrom: normalizeHistoryDate(input.dateFrom, input.datePrecision),
        dateTo: input.dateTo ? normalizeHistoryDate(input.dateTo, input.datePrecision) : null,
        text: input.text,
        status: input.status,
        createdBy: ctx.userId,
      })
      .returning()
      .get();
    replaceSources(tx, row.id, input.sources);
    if (row.status === "approved") reindexLocations(tx, [row.locationId]);
    // Ids and the status only: no history text in the audit log.
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "history.created",
      diff: { historyId: row.id, locationId: row.locationId, status: row.status },
    });
    return { id: row.id, version: row.version };
  });
}

export function updateHistory(
  db: AppDb,
  ctx: AuthCtx,
  raw: UpdateHistoryInput,
): { version: number } {
  const input = parseAppInput(updateHistoryInput, raw);
  return db.transaction((tx) => {
    const row = requireRow(tx, ctx, input.id);
    if (!canEditHistory(ctx, levelFor(tx, ctx, row.locationId)))
      throw appForbidden("HISTORY_FORBIDDEN");
    if (row.version !== input.version) throw appConflict();
    const set: Partial<typeof history.$inferInsert> = { updatedAt: new Date() };
    if (input.datePrecision && input.dateFrom !== undefined) {
      set.datePrecision = input.datePrecision;
      set.dateFrom = normalizeHistoryDate(input.dateFrom, input.datePrecision);
      set.dateTo = input.dateTo ? normalizeHistoryDate(input.dateTo, input.datePrecision) : null;
    }
    if (input.text !== undefined) set.text = input.text;
    if (input.sources !== undefined) replaceSources(tx, row.id, input.sources);
    const updated = tx
      .update(history)
      .set({ ...set, version: input.version + 1 })
      .where(and(eq(history.id, row.id), eq(history.version, input.version)))
      .returning({ version: history.version })
      .get();
    if (!updated) throw appConflict();
    if (row.status === "approved") reindexLocations(tx, [row.locationId]);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "history.updated",
      diff: { historyId: row.id, locationId: row.locationId },
    });
    return { version: updated.version };
  });
}

/** Turns a draft (e.g. a research fact) into an approved, searchable entry. */
export function approveHistory(
  db: AppDb,
  ctx: AuthCtx,
  raw: { id: string; version: number },
): { version: number } {
  const input = parseAppInput(approveHistoryInput, raw);
  return db.transaction((tx) => {
    const row = requireRow(tx, ctx, input.id);
    if (!canEditHistory(ctx, levelFor(tx, ctx, row.locationId)))
      throw appForbidden("HISTORY_FORBIDDEN");
    if (row.version !== input.version) throw appConflict();
    if (row.status === "approved") return { version: row.version };
    const updated = tx
      .update(history)
      .set({ status: "approved", version: input.version + 1, updatedAt: new Date() })
      .where(and(eq(history.id, row.id), eq(history.version, input.version)))
      .returning({ version: history.version })
      .get();
    if (!updated) throw appConflict();
    reindexLocations(tx, [row.locationId]);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "history.approved",
      diff: { historyId: row.id, locationId: row.locationId },
    });
    return { version: updated.version };
  });
}

export function deleteHistory(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const row = requireRow(tx, ctx, id);
    if (!canEditHistory(ctx, levelFor(tx, ctx, row.locationId)))
      throw appForbidden("HISTORY_FORBIDDEN");
    tx.delete(history).where(eq(history.id, row.id)).run();
    reindexLocations(tx, [row.locationId]);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "history.deleted",
      diff: { historyId: row.id, locationId: row.locationId },
    });
  });
}
