// Visits and journal (request-independent; ./functions.ts adds authMiddleware).
// Visibility from ../authz/visits.ts, in SQL only. journalMd only for editors.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { addDays, todayInTz } from "@trespass/shared/format";
import {
  type CreateVisitInput,
  createVisitInput,
  type FeedInput,
  feedInput,
  type UpdateVisitInput,
  updateVisitInput,
  type VisitPersonInput,
  yearInput,
} from "@trespass/shared/visits/inputs";
import type {
  FeedPage,
  SerializedVisit,
  SerializedVisitPerson,
  TimelineEntry,
  YearReview,
} from "@trespass/shared/visits/types";
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { recordEvent } from "../audit";
import {
  canCreateVisit,
  canMutateVisit,
  loadLocationForCtx,
  locationLevels,
  visibleVisitLocationWhere,
  visibleVisitsWhere,
  visitLocation,
} from "../authz";
import type { Level } from "../authz/levels";
import type { AppDb, DbOrTx } from "../db/client";

import { events, locations, type NewVisitPerson, users, visitPeople, visits } from "../db/schema";
import { listHistory } from "../history/service";
import { forbidden, notFound } from "../locations/errors";
import { visitCreateTime } from "../locations/status";
import { journalExcerpt, photoEmbedIds, renderJournalMarkdown } from "../markdown";
import { resolvePhotoEmbeds } from "../photos/service";
import { checkTripForVisit } from "../trips/service";
import {
  conflict,
  invalidDate,
  parseInput,
  VisitsError,
  visitForbidden,
  visitNotFound,
} from "./errors";

const asDb = (db: DbOrTx) => db as unknown as AppDb;

// --- Cursor --------------------------------------------------------------------

type FeedCursor = { at: number; id: string };

function decodeCursor(raw: string | undefined): FeedCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as FeedCursor).id === "string" &&
      typeof (value as FeedCursor).at === "number"
    ) {
      return value as FeedCursor;
    }
  } catch {
    // fall through to the explicit error
  }
  throw new VisitsError(422, "CURSOR_INVALID");
}

const encodeCursor = (c: FeedCursor) =>
  Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

// --- Helpers --------------------------------------------------------------------

function peopleFor(db: DbOrTx, visitId: string): SerializedVisitPerson[] {
  return db
    .select({
      userId: visitPeople.userId,
      name: visitPeople.name,
      displayName: users.displayName,
    })
    .from(visitPeople)
    .leftJoin(users, eq(users.id, visitPeople.userId))
    .where(eq(visitPeople.visitId, visitId))
    .all()
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      displayName: p.name ?? p.displayName ?? p.userId ?? "",
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "de"));
}

function replacePeople(db: DbOrTx, visitId: string, people: readonly VisitPersonInput[]) {
  db.delete(visitPeople).where(eq(visitPeople.visitId, visitId)).run();
  const rows: NewVisitPerson[] = people.map((p) => ({
    visitId,
    userId: "userId" in p ? p.userId : null,
    name: "name" in p ? p.name : null,
  }));
  if (rows.length) db.insert(visitPeople).values(rows).run();
}

function checkPeople(db: DbOrTx, people: readonly VisitPersonInput[]) {
  for (const p of people) {
    if (!("userId" in p)) continue;
    const user = db
      .select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, p.userId))
      .get();
    if (!user || user.disabledAt) throw new VisitsError(422, "VISIT_PERSON_INVALID");
  }
}

function checkDay(day: string, tz: string) {
  if (day > addDays(todayInTz(tz), 1) || day < "1900-01-01") throw invalidDate();
}

function levelFor(db: DbOrTx, ctx: AuthCtx, locationId: string): Level {
  return loadLocationForCtx(asDb(db), ctx, locationId)?.level ?? "none";
}

/** A row from a query that ANDed visibleVisitsWhere(ctx). */
type VisitRow = {
  visit: typeof visits.$inferSelect;
  locationId: string | null;
  locationName: string | null;
  country: string | null;
  locationVisible: number;
};

function serializeRow(db: DbOrTx, ctx: AuthCtx, row: VisitRow, level: Level): SerializedVisit {
  // Batch-check embedded photo ids in SQL with the photo visibility predicate;
  // a photo the viewer cannot see is dropped rather than linked.
  const embeds = resolvePhotoEmbeds(asDb(db), ctx, photoEmbedIds(row.visit.journalMd));
  const canEdit = canMutateVisit(ctx, row.visit, level, "edit");
  const canDelete = canMutateVisit(ctx, row.visit, level, "delete");
  const out: SerializedVisit = {
    id: row.visit.id,
    locationId: row.visit.locationId,
    // The author keeps the visit, but never the location after it went invisible.
    location:
      row.locationId && row.locationVisible
        ? { id: row.locationId, name: row.locationName ?? "", country: row.country }
        : null,
    authorId: row.visit.authorId,
    authorName:
      db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, row.visit.authorId))
        .get()?.name ?? "",
    visitedOn: row.visit.visitedOn,
    conditions: row.visit.conditions,
    journalHtml: renderJournalMarkdown(row.visit.journalMd, {
      resolvePhoto: (id) => embeds.get(id) ?? null,
    }),
    excerpt: journalExcerpt(row.visit.journalMd),
    people: peopleFor(db, row.visit.id),
    permissions: { canEdit, canDelete },
    version: row.visit.version,
    createdAt: row.visit.createdAt,
    updatedAt: row.visit.updatedAt,
  };
  if (canEdit) out.journalMd = row.visit.journalMd;
  return out;
}

/** Loads one authorized visit row; invisible or missing both look like 404. */
function requireVisitRow(db: DbOrTx, ctx: AuthCtx, id: string): VisitRow {
  const loc = visitLocation();
  const row = db
    .select({
      visit: visits,
      locationId: loc.id,
      locationName: loc.name,
      country: loc.country,
      locationVisible: visibleVisitLocationWhere(ctx, loc),
    })
    .from(visits)
    .leftJoin(loc, eq(loc.id, visits.locationId))
    .where(and(eq(visits.id, id), visibleVisitsWhere(ctx, visits)))
    .get();
  if (!row) throw visitNotFound();
  return row;
}

// --- Create ---------------------------------------------------------------------

export function createVisit(
  db: AppDb,
  ctx: AuthCtx,
  raw: CreateVisitInput,
): { id: string; version: number } {
  const input = parseInput(createVisitInput, raw);
  return db.transaction((tx) => {
    const found = loadLocationForCtx(asDb(tx), ctx, input.locationId, "view");
    if (!found) throw notFound();
    if (!canCreateVisit(ctx, found.level)) throw forbidden();
    const day = input.visitedOn ?? todayInTz(found.location.tz);
    checkDay(day, found.location.tz);
    checkPeople(tx, input.people);
    checkTripForVisit(tx, ctx, input.tripId);
    const at = visitCreateTime(tx, found.location.id);
    const row = tx
      .insert(visits)
      .values({
        locationId: found.location.id,
        authorId: ctx.userId,
        visitedOn: day,
        conditions: input.conditions,
        journalMd: input.journalMd,
        tripId: input.tripId ?? null,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
    replacePeople(tx, row.id, input.people);
    // No journal text, coordinates or people's names in the audit diff.
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "visit.created",
      diff: { visitId: row.id, locationId: row.locationId, visitedOn: day },
    });
    return { id: row.id, version: row.version };
  });
}

// --- Update / delete -------------------------------------------------------------

export function updateVisit(db: AppDb, ctx: AuthCtx, raw: UpdateVisitInput): { version: number } {
  const input = parseInput(updateVisitInput, raw);
  return db.transaction((tx) => {
    const row = requireVisitRow(tx, ctx, input.id);
    const level = levelFor(tx, ctx, row.visit.locationId);
    if (!canMutateVisit(ctx, row.visit, level, "edit")) throw visitForbidden();
    if (row.visit.version !== input.version) throw conflict();

    const set: Partial<typeof visits.$inferInsert> = { updatedAt: new Date() };
    if (input.visitedOn !== undefined) {
      const day = input.visitedOn;
      const location = tx
        .select({ tz: locations.tz })
        .from(locations)
        .where(eq(locations.id, row.visit.locationId))
        .get();
      checkDay(day, location?.tz ?? "Etc/UTC");
      set.visitedOn = day;
    }
    if (input.conditions !== undefined) set.conditions = input.conditions;
    if (input.journalMd !== undefined) set.journalMd = input.journalMd;
    if (input.tripId !== undefined) {
      checkTripForVisit(tx, ctx, input.tripId);
      set.tripId = input.tripId;
    }
    if (input.people !== undefined) {
      checkPeople(tx, input.people);
      replacePeople(tx, row.visit.id, input.people);
    }
    const updated = tx
      .update(visits)
      .set({ ...set, version: input.version + 1 })
      .where(and(eq(visits.id, row.visit.id), eq(visits.version, input.version)))
      .returning({ version: visits.version })
      .get();
    if (!updated) throw conflict();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.visit.id,
      action: "visit.updated",
      diff: { visitId: row.visit.id, locationId: row.visit.locationId },
    });
    return { version: updated.version };
  });
}

export function deleteVisit(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const row = requireVisitRow(tx, ctx, id);
    const level = levelFor(tx, ctx, row.visit.locationId);
    if (!canMutateVisit(ctx, row.visit, level, "delete")) throw visitForbidden();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.visit.id,
      action: "visit.deleted",
      diff: { visitId: row.visit.id, locationId: row.visit.locationId },
    });
    tx.delete(visits).where(eq(visits.id, row.visit.id)).run();
  });
}

// --- Read ------------------------------------------------------------------------

export function getVisit(db: AppDb, ctx: AuthCtx, id: string): SerializedVisit {
  const row = requireVisitRow(db, ctx, id);
  const level = levelFor(db, ctx, row.visit.locationId);
  return serializeRow(db, ctx, row, level);
}

export function listVisitsForLocation(
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
): SerializedVisit[] {
  const found = loadLocationForCtx(db, ctx, locationId, "view");
  if (!found) throw notFound();
  const loc = visitLocation();
  const query = db
    .select({
      visit: visits,
      locationId: loc.id,
      locationName: loc.name,
      country: loc.country,
      locationVisible: visibleVisitLocationWhere(ctx, loc),
    })
    .from(visits)
    .leftJoin(loc, eq(loc.id, visits.locationId))
    .where(and(eq(visits.locationId, locationId), visibleVisitsWhere(ctx, visits)))
    .orderBy(desc(visits.visitedOn), desc(visits.createdAt));
  const rows = query.all();
  return rows.map((row) => serializeRow(db, ctx, row, found.level));
}

/** Journal feed of everything the caller can see, newest first, cursor paged. */
export function listFeed(db: AppDb, ctx: AuthCtx, raw: FeedInput): FeedPage {
  const input = parseInput(feedInput, raw);
  const cursor = decodeCursor(input.cursor);
  const loc = visitLocation();
  const conditions: SQL[] = [visibleVisitsWhere(ctx, visits)];
  if (input.authorId) conditions.push(eq(visits.authorId, input.authorId));
  if (input.year) conditions.push(sql`${visits.visitedOn} like ${`${input.year}-%`}`);
  if (cursor) {
    conditions.push(
      sql`(${visits.createdAt} < ${cursor.at} or (${visits.createdAt} = ${cursor.at} and ${visits.id} < ${cursor.id}))`,
    );
  }
  const rows = db
    .select({
      visit: visits,
      locationId: loc.id,
      locationName: loc.name,
      country: loc.country,
      locationVisible: visibleVisitLocationWhere(ctx, loc),
      ownerId: loc.ownerId,
      visibility: loc.visibility,
      friendsLevel: loc.friendsLevel,
    })
    .from(visits)
    .leftJoin(loc, eq(loc.id, visits.locationId))
    .where(and(...conditions))
    .orderBy(desc(visits.createdAt), desc(visits.id))
    .limit(input.limit + 1)
    .all();
  const page = rows.slice(0, input.limit);
  const levels = locationLevels(
    db,
    ctx,
    page.flatMap((r) =>
      r.locationId && r.ownerId && r.visibility && r.friendsLevel
        ? [
            {
              id: r.locationId,
              ownerId: r.ownerId,
              visibility: r.visibility,
              friendsLevel: r.friendsLevel,
            },
          ]
        : [],
    ),
  );
  const out = page.map((row) =>
    serializeRow(db, ctx, row, levels.get(row.locationId ?? "") ?? "none"),
  );
  let nextCursor: string | null = null;
  if (rows.length > input.limit && page.length) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor({ at: last.visit.createdAt.getTime(), id: last.visit.id });
  }
  return { rows: out, nextCursor };
}

/** Export: all visible visits, paged via the feed's SQL predicate and serializer. */
export async function* visitPagesForExport(
  db: AppDb,
  ctx: AuthCtx,
  pageSize = 100,
): AsyncGenerator<SerializedVisit[]> {
  let cursor: string | undefined;
  for (;;) {
    const page = listFeed(db, ctx, {
      limit: Math.min(Math.max(1, pageSize), 100),
      ...(cursor ? { cursor } : {}),
    });
    if (page.rows.length === 0) return;
    yield page.rows;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Counts over visible visits only; countries come from visible locations. */
export function yearReview(db: AppDb, ctx: AuthCtx, raw: { year: number }): YearReview {
  const { year } = parseInput(yearInput, raw);
  const loc = visitLocation();
  const rows = db
    .select({
      locationId: visits.locationId,
      visitedOn: visits.visitedOn,
      country: sql<
        string | null
      >`case when ${visibleVisitLocationWhere(ctx, loc)} then ${loc.country} else null end`,
    })
    .from(visits)
    .leftJoin(loc, eq(loc.id, visits.locationId))
    .where(and(visibleVisitsWhere(ctx, visits), sql`${visits.visitedOn} like ${`${year}-%`}`))
    .all();
  const months = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    const month = Number(row.visitedOn.slice(5, 7));
    if (month >= 1 && month <= 12) months[month - 1]++;
  }
  return {
    year,
    visits: rows.length,
    locations: new Set(rows.map((r) => r.locationId)).size,
    countries: new Set(rows.map((r) => r.country).filter((c): c is string => Boolean(c))).size,
    months,
  };
}

/** Visits, status changes and history entries of one visible location, newest first. */
export function getLocationTimeline(db: AppDb, ctx: AuthCtx, locationId: string): TimelineEntry[] {
  const found = loadLocationForCtx(db, ctx, locationId, "view");
  if (!found) throw notFound();
  const visitEntries: TimelineEntry[] = listVisitsForLocation(db, ctx, locationId).map((visit) => ({
    kind: "visit",
    date: visit.visitedOn,
    visit,
  }));
  const rows = db
    .select({ at: events.at, diff: events.diff })
    .from(events)
    .where(
      and(
        eq(events.entityId, locationId),
        inArray(events.action, ["location.status_changed", "location.updated"]),
        sql`${events.diff} like '%status%'`,
      ),
    )
    .all();
  const statusEntries: TimelineEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row.diff as { status?: unknown } | null;
    const s = raw?.status;
    let from: string | null = null;
    let to: string | null = null;
    if (s && typeof s === "object" && "from" in s && "to" in s) {
      const d = s as { from: unknown; to: unknown };
      from = typeof d.from === "string" ? d.from : null;
      to = typeof d.to === "string" ? d.to : null;
    } else if (typeof s === "string") {
      to = s;
    }
    if (!from && !to) continue;
    const date = todayInTz(found.location.tz, row.at);
    // create/update wrote both a generic and a status event for the same
    // change; show it once in the timeline.
    const key = `${date}|${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    statusEntries.push({ kind: "status", date, from, to });
  }
  const historyEntries: TimelineEntry[] = listHistory(db, ctx, locationId).map((h) => ({
    kind: "history",
    date: h.dateFrom,
    history: h,
  }));
  return [...visitEntries, ...statusEntries, ...historyEntries].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}
