// Trips: stops, people, emergency contact, packing list and report (DESIGN
// §5.5). Visibility comes from authz/trips.ts (SQL). A trip never widens what
// a viewer may see of its stops: stop locations are loaded with
// visibleLocationsWhere(ctx) and serialized with serializeLocation at the
// viewer's own level; every visible stop is shown at its exact point.
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type { LocationStatus } from "@trespass/shared/locations/types";
import {
  type CreateTripInput,
  createTripInput,
  type EmergencyContactInput,
  listTripsInput,
  MAX_STOPS,
  type TripPersonInput,
  type UpdateTripInput,
  updateTripInput,
} from "@trespass/shared/trips/inputs";
import type {
  SerializedChecklistItem,
  SerializedEmergencyContact,
  SerializedTrip,
  SerializedTripPerson,
  SerializedTripStop,
  TripSummary,
  TripVisitRef,
} from "@trespass/shared/trips/types";
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { recordEvent } from "../audit";
import {
  canEditTrip,
  canPackTrip,
  locationLevels,
  serializeLocation,
  visibleLocationsWhere,
  visibleTripsWhere,
  visibleVisitLocationWhere,
  visibleVisitsWhere,
  visitLocation,
} from "../authz";
import { can } from "../authz/actions";
import type { AppDb, DbOrTx } from "../db/client";
import {
  categories,
  type EmergencyContact,
  equipment,
  locations,
  packTemplateItems,
  type Trip,
  tripChecklist,
  tripPeople,
  tripStops,
  trips,
  users,
  visits,
} from "../db/schema";
import { requireTemplate } from "../equipment/service";
import { appConflict, appForbidden, appInvalid, appNotFound, parseAppInput } from "../errors";
import { effectiveStatusExpr } from "../locations/status";
import { renderMarkdown } from "../markdown";

const asDb = (db: DbOrTx) => db as unknown as AppDb;
const notFound = () => appNotFound("TRIP_NOT_FOUND");
const forbidden = () => appForbidden("TRIP_FORBIDDEN");

// --- Loading ------------------------------------------------------------------------

/** One visible trip, or 404. */
export function requireTrip(db: DbOrTx, ctx: AuthCtx, id: string): Trip {
  const row = db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), visibleTripsWhere(ctx, trips)))
    .get();
  if (!row) throw notFound();
  return row;
}

function requireEditableTrip(db: DbOrTx, ctx: AuthCtx, id: string): Trip {
  const trip = requireTrip(db, ctx, id);
  if (!canEditTrip(ctx, trip)) throw forbidden();
  return trip;
}

function displayNames(db: DbOrTx, ids: readonly (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map<string, string>();
  return new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, unique))
      .all()
      .map((u) => [u.id, u.name]),
  );
}

function requireActiveUser(db: DbOrTx, userId: string, code: string) {
  const user = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .get();
  if (!user) throw appInvalid(code);
}

/** Locations among `ids` that ctx can see, in SQL. Any invisible id is TRIP_STOP_INVALID. */
function requireVisibleLocations(db: DbOrTx, ctx: AuthCtx, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = db
    .select({ id: locations.id })
    .from(locations)
    .where(and(inArray(locations.id, unique), visibleLocationsWhere(ctx, locations)))
    .all();
  if (rows.length !== unique.length) throw appInvalid("TRIP_STOP_INVALID");
  return unique;
}

// --- People and contact -----------------------------------------------------------------

function replacePeople(db: DbOrTx, tripId: string, people: readonly TripPersonInput[]) {
  const seen = new Set<string>();
  for (const p of people)
    if ("userId" in p) {
      requireActiveUser(db, p.userId, "TRIP_PERSON_INVALID");
      if (seen.has(p.userId)) throw appInvalid("TRIP_PERSON_INVALID");
      seen.add(p.userId);
    }
  db.delete(tripPeople).where(eq(tripPeople.tripId, tripId)).run();
  if (people.length)
    db.insert(tripPeople)
      .values(
        people.map((p) => ({
          tripId,
          userId: "userId" in p ? p.userId : null,
          name: "name" in p ? p.name : null,
        })),
      )
      .run();
}

function contactValue(
  db: DbOrTx,
  input: EmergencyContactInput | null | undefined,
): EmergencyContact | null {
  if (!input) return null;
  if ("userId" in input) {
    requireActiveUser(db, input.userId, "EMERGENCY_CONTACT_INVALID");
    return { userId: input.userId };
  }
  return { name: input.name, email: input.email ?? null, ntfyTopic: input.ntfyTopic ?? null };
}

function serializeContact(
  contact: EmergencyContact | null,
  names: Map<string, string>,
): SerializedEmergencyContact | null {
  if (!contact) return null;
  if ("userId" in contact)
    return { kind: "user", userId: contact.userId, displayName: names.get(contact.userId) ?? "" };
  return {
    kind: "external",
    name: contact.name,
    email: contact.email ?? null,
    ntfyTopic: contact.ntfyTopic ?? null,
  };
}

// --- Stops ----------------------------------------------------------------------------------

/** Stops visible to ctx, in order, serialized at ctx's level (SQL visibility only). */
function visibleStops(db: DbOrTx, ctx: AuthCtx, tripId: string): SerializedTripStop[] {
  const rows = db
    .select({
      sort: tripStops.sort,
      location: locations,
      effectiveStatus: sql<LocationStatus>`${effectiveStatusExpr()}`,
      category: {
        id: categories.id,
        key: categories.key,
        name: categories.name,
        icon: categories.icon,
      },
    })
    .from(tripStops)
    .innerJoin(locations, eq(locations.id, tripStops.locationId))
    .leftJoin(categories, eq(categories.id, locations.categoryId))
    .where(and(eq(tripStops.tripId, tripId), visibleLocationsWhere(ctx, locations)))
    .orderBy(asc(tripStops.sort), asc(tripStops.locationId))
    .all();
  const levels = locationLevels(
    asDb(db),
    ctx,
    rows.map((r) => r.location),
  );
  const out: SerializedTripStop[] = [];
  for (const r of rows) {
    const level = levels.get(r.location.id);
    if (!level || level === "none") continue; // safety net, not a filter
    out.push({
      sort: r.sort,
      location: serializeLocation(r.location, level, {
        category: r.category?.id ? r.category : null,
        effectiveStatus: r.effectiveStatus,
      }),
    });
  }
  return out;
}

function allStopIds(db: DbOrTx, tripId: string): string[] {
  return db
    .select({ id: tripStops.locationId })
    .from(tripStops)
    .where(eq(tripStops.tripId, tripId))
    .orderBy(asc(tripStops.sort), asc(tripStops.locationId))
    .all()
    .map((r) => r.id);
}

function writeStops(db: DbOrTx, tripId: string, ordered: readonly string[]) {
  db.delete(tripStops).where(eq(tripStops.tripId, tripId)).run();
  if (ordered.length)
    db.insert(tripStops)
      .values(ordered.map((locationId, sort) => ({ tripId, locationId, sort })))
      .run();
}

// --- Serialize ------------------------------------------------------------------------------

function checklistOf(db: DbOrTx, tripId: string): SerializedChecklistItem[] {
  return db
    .select({
      id: tripChecklist.id,
      label: tripChecklist.label,
      packed: tripChecklist.packed,
      equipmentId: tripChecklist.equipmentId,
      needsCharging: equipment.needsCharging,
    })
    .from(tripChecklist)
    .leftJoin(equipment, eq(equipment.id, tripChecklist.equipmentId))
    .where(eq(tripChecklist.tripId, tripId))
    .orderBy(asc(tripChecklist.sort), asc(tripChecklist.id))
    .all()
    .map((r) => ({ ...r, needsCharging: r.needsCharging ?? false }));
}

/** Visits linked to the trip that ctx can see (visibleVisitsWhere in SQL). */
function tripVisits(db: DbOrTx, ctx: AuthCtx, tripId: string): TripVisitRef[] {
  const loc = visitLocation();
  return db
    .select({
      id: visits.id,
      visitedOn: visits.visitedOn,
      authorName: users.displayName,
      locationId: loc.id,
      locationName: loc.name,
      locationVisible: visibleVisitLocationWhere(ctx, loc),
    })
    .from(visits)
    .leftJoin(loc, eq(loc.id, visits.locationId))
    .leftJoin(users, eq(users.id, visits.authorId))
    .where(and(eq(visits.tripId, tripId), visibleVisitsWhere(ctx, visits)))
    .orderBy(asc(visits.visitedOn), asc(visits.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      visitedOn: r.visitedOn,
      authorName: r.authorName ?? "",
      location:
        r.locationId && r.locationVisible ? { id: r.locationId, name: r.locationName ?? "" } : null,
    }));
}

function serializeTrip(db: DbOrTx, ctx: AuthCtx, trip: Trip): SerializedTrip {
  const people = db.select().from(tripPeople).where(eq(tripPeople.tripId, trip.id)).all();
  const contact = trip.emergencyContact ?? null;
  const names = displayNames(db, [
    trip.ownerId,
    ...people.map((p) => p.userId),
    contact && "userId" in contact ? contact.userId : null,
  ]);
  const editable = canEditTrip(ctx, trip);
  const stops = visibleStops(db, ctx, trip.id);
  const out: SerializedTrip = {
    id: trip.id,
    ownerId: trip.ownerId,
    ownerName: names.get(trip.ownerId) ?? "",
    title: trip.title,
    startsOn: trip.startsOn,
    endsOn: trip.endsOn,
    status: trip.status,
    notes: trip.notes,
    reportHtml: renderMarkdown(trip.reportMd, { resolvePhoto: () => null }),
    people: people
      .map(
        (p): SerializedTripPerson => ({
          userId: p.userId,
          name: p.name,
          displayName: p.name ?? names.get(p.userId ?? "") ?? "",
        }),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "de")),
    emergencyContact: serializeContact(contact, names),
    stops,
    checklist: checklistOf(db, trip.id),
    visits: tripVisits(db, ctx, trip.id),
    permissions: { canEdit: editable, canDelete: editable, canPack: canPackTrip(ctx) },
    version: trip.version,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
  if (editable) {
    out.reportMd = trip.reportMd;
    // The owner added these stops; telling them how many they lost sight of leaks nothing new.
    out.hiddenStops = allStopIds(db, trip.id).length - stops.length;
  }
  return out;
}

// --- Read -----------------------------------------------------------------------------------

export function getTrip(db: AppDb, ctx: AuthCtx, id: string): SerializedTrip {
  return serializeTrip(db, ctx, requireTrip(db, ctx, id));
}

/** Trips ctx can see: upcoming and active first, then the rest newest first. */
export function listTrips(db: AppDb, ctx: AuthCtx, raw: { open?: boolean } = {}): TripSummary[] {
  const input = parseAppInput(listTripsInput, raw);
  const where: SQL[] = [visibleTripsWhere(ctx, trips)];
  if (input.open) where.push(inArray(trips.status, ["planned", "active"]));
  const stopCount = sql<number>`(select count(*) from ${tripStops} join ${locations} on ${locations.id} = ${tripStops.locationId} where ${tripStops.tripId} = ${trips.id} and ${visibleLocationsWhere(ctx, locations)})`;
  const rows = db
    .select({
      id: trips.id,
      title: trips.title,
      startsOn: trips.startsOn,
      endsOn: trips.endsOn,
      status: trips.status,
      ownerId: trips.ownerId,
      ownerName: users.displayName,
      stopCount,
    })
    .from(trips)
    .leftJoin(users, eq(users.id, trips.ownerId))
    .where(and(...where))
    .orderBy(
      sql`case when ${trips.status} in ('planned', 'active') then 0 else 1 end`,
      desc(sql`coalesce(${trips.startsOn}, '9999-12-31')`),
      desc(trips.createdAt),
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: r.status,
    ownerName: r.ownerName ?? "",
    isOwner: r.ownerId === ctx.userId,
    stopCount: Number(r.stopCount),
  }));
}

/** Every visible trip, serialized (export). */
export function* tripPagesForExport(
  db: AppDb,
  ctx: AuthCtx,
  pageSize = 100,
): Generator<SerializedTrip[]> {
  let after = "";
  for (;;) {
    const where: SQL[] = [visibleTripsWhere(ctx, trips)];
    if (after) where.push(sql`${trips.id} > ${after}`);
    const rows = db
      .select()
      .from(trips)
      .where(and(...where))
      .orderBy(asc(trips.id))
      .limit(pageSize)
      .all();
    if (rows.length === 0) return;
    after = rows[rows.length - 1]!.id;
    yield rows.map((t) => serializeTrip(db, ctx, t));
  }
}

// --- Write: trip ------------------------------------------------------------------------------

export function createTrip(db: AppDb, ctx: AuthCtx, raw: CreateTripInput): { id: string } {
  if (!can(ctx, "createTrip")) throw forbidden();
  const input = parseAppInput(createTripInput, raw);
  return db.transaction((tx) => {
    const stops = requireVisibleLocations(tx, ctx, input.locationIds);
    const row = tx
      .insert(trips)
      .values({
        ownerId: ctx.userId,
        title: input.title,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        notes: input.notes,
        emergencyContact: contactValue(tx, input.emergencyContact),
      })
      .returning({ id: trips.id })
      .get();
    replacePeople(tx, row.id, input.people);
    writeStops(tx, row.id, stops);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "trip.created",
      diff: { tripId: row.id, stops: stops.length },
    });
    return { id: row.id };
  });
}

export function updateTrip(db: AppDb, ctx: AuthCtx, raw: UpdateTripInput): { version: number } {
  const input = parseAppInput(updateTripInput, raw);
  return db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, input.id);
    if (trip.version !== input.version) throw appConflict();
    const set: Partial<typeof trips.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title;
    if (input.startsOn !== undefined) set.startsOn = input.startsOn;
    if (input.endsOn !== undefined) set.endsOn = input.endsOn;
    const startsOn = set.startsOn !== undefined ? set.startsOn : trip.startsOn;
    const endsOn = set.endsOn !== undefined ? set.endsOn : trip.endsOn;
    if (startsOn && endsOn && endsOn < startsOn) throw appInvalid("TRIP_DATES_INVALID");
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.reportMd !== undefined) set.reportMd = input.reportMd;
    if (input.status !== undefined) set.status = input.status;
    if (input.emergencyContact !== undefined)
      set.emergencyContact = contactValue(tx, input.emergencyContact);
    if (input.people !== undefined) replacePeople(tx, trip.id, input.people);
    const updated = tx
      .update(trips)
      .set({ ...set, version: input.version + 1 })
      .where(and(eq(trips.id, trip.id), eq(trips.version, input.version)))
      .returning({ version: trips.version })
      .get();
    if (!updated) throw appConflict();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: trip.id,
      action: "trip.updated",
      diff: { tripId: trip.id, ...(input.status ? { status: input.status } : {}) },
    });
    return { version: updated.version };
  });
}

/** Visits keep existing; they only lose the trip link. */
export function deleteTrip(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, id);
    tx.update(visits).set({ tripId: null }).where(eq(visits.tripId, trip.id)).run();
    tx.delete(trips).where(eq(trips.id, trip.id)).run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: trip.id,
      action: "trip.deleted",
      diff: { tripId: trip.id },
    });
  });
}

// --- Write: stops --------------------------------------------------------------------------

/**
 * Reorders/replaces the stops the editor can see. Stops whose location the
 * editor can no longer see are kept (after the visible ones): an editor cannot
 * remove what they cannot name, and the order of hidden stops is not revealed.
 */
export function setTripStops(
  db: AppDb,
  ctx: AuthCtx,
  raw: { id: string; locationIds: string[] },
): SerializedTrip {
  return db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, raw.id);
    const visible = requireVisibleLocations(tx, ctx, raw.locationIds);
    const shown = new Set(visibleStops(tx, ctx, trip.id).map((s) => s.location.id));
    const hidden = allStopIds(tx, trip.id).filter((id) => !shown.has(id));
    const next = [...visible.filter((id) => !hidden.includes(id)), ...hidden];
    if (next.length > MAX_STOPS) throw appInvalid("TRIP_STOPS_FULL");
    writeStops(tx, trip.id, next);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: trip.id,
      action: "trip.stops",
      diff: { tripId: trip.id, stops: next.length },
    });
    return serializeTrip(tx, ctx, trip);
  });
}

export function addTripStop(
  db: AppDb,
  ctx: AuthCtx,
  raw: { tripId: string; locationId: string },
): { added: boolean } {
  return db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, raw.tripId);
    requireVisibleLocations(tx, ctx, [raw.locationId]);
    const ids = allStopIds(tx, trip.id);
    if (ids.includes(raw.locationId)) return { added: false };
    if (ids.length >= MAX_STOPS) throw appInvalid("TRIP_STOPS_FULL");
    tx.insert(tripStops)
      .values({ tripId: trip.id, locationId: raw.locationId, sort: ids.length })
      .run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: trip.id,
      action: "trip.stops",
      diff: { tripId: trip.id, stops: ids.length + 1 },
    });
    return { added: true };
  });
}

export function removeTripStop(
  db: AppDb,
  ctx: AuthCtx,
  raw: { tripId: string; locationId: string },
): void {
  db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, raw.tripId);
    requireVisibleLocations(tx, ctx, [raw.locationId]);
    const next = allStopIds(tx, trip.id).filter((id) => id !== raw.locationId);
    writeStops(tx, trip.id, next);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: trip.id,
      action: "trip.stops",
      diff: { tripId: trip.id, stops: next.length },
    });
  });
}

// --- Write: packing list ------------------------------------------------------------------

function nextSort(db: DbOrTx, tripId: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${tripChecklist.sort})` })
    .from(tripChecklist)
    .where(eq(tripChecklist.tripId, tripId))
    .get();
  return (row?.max ?? -1) + 1;
}

export function addChecklistItem(
  db: AppDb,
  ctx: AuthCtx,
  raw: { tripId: string; label: string },
): { id: string } {
  return db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, raw.tripId);
    const label = raw.label.trim();
    if (!label || label.length > 120) throw appInvalid("INVALID_INPUT");
    return tx
      .insert(tripChecklist)
      .values({ tripId: trip.id, label, sort: nextSort(tx, trip.id) })
      .returning({ id: tripChecklist.id })
      .get();
  });
}

/**
 * Merges one of the EDITOR's own templates into the list. Equipment already on
 * the list is not added twice. Labels are copied from the equipment names.
 */
export function addTemplateToTrip(
  db: AppDb,
  ctx: AuthCtx,
  raw: { tripId: string; templateId: string },
): { added: number } {
  return db.transaction((tx) => {
    const trip = requireEditableTrip(tx, ctx, raw.tripId);
    const template = requireTemplate(tx, ctx, raw.templateId);
    const items = tx
      .select({ id: equipment.id, name: equipment.name })
      .from(packTemplateItems)
      .innerJoin(equipment, eq(equipment.id, packTemplateItems.equipmentId))
      .where(and(eq(packTemplateItems.templateId, template.id), eq(equipment.ownerId, ctx.userId)))
      .orderBy(asc(equipment.category), asc(equipment.name))
      .all();
    const present = new Set(
      tx
        .select({ id: tripChecklist.equipmentId })
        .from(tripChecklist)
        .where(eq(tripChecklist.tripId, trip.id))
        .all()
        .map((r) => r.id),
    );
    const fresh = items.filter((i) => !present.has(i.id));
    let sort = nextSort(tx, trip.id);
    if (fresh.length)
      tx.insert(tripChecklist)
        .values(
          fresh.map((i) => ({ tripId: trip.id, equipmentId: i.id, label: i.name, sort: sort++ })),
        )
        .run();
    return { added: fresh.length };
  });
}

function requireChecklistItem(db: DbOrTx, ctx: AuthCtx, id: string) {
  const row = db.select().from(tripChecklist).where(eq(tripChecklist.id, id)).get();
  if (!row) throw appNotFound("CHECKLIST_ITEM_NOT_FOUND");
  // The trip's own visibility decides; an invisible trip's item is "not found".
  const trip = db
    .select()
    .from(trips)
    .where(and(eq(trips.id, row.tripId), visibleTripsWhere(ctx, trips)))
    .get();
  if (!trip) throw appNotFound("CHECKLIST_ITEM_NOT_FOUND");
  return { row, trip };
}

/** Everyone on the trip except guests may tick items. */
export function setChecklistPacked(
  db: AppDb,
  ctx: AuthCtx,
  raw: { id: string; packed: boolean },
): void {
  db.transaction((tx) => {
    const { row } = requireChecklistItem(tx, ctx, raw.id);
    if (!canPackTrip(ctx)) throw forbidden();
    tx.update(tripChecklist).set({ packed: raw.packed }).where(eq(tripChecklist.id, row.id)).run();
  });
}

export function removeChecklistItem(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const { row, trip } = requireChecklistItem(tx, ctx, id);
    if (!canEditTrip(ctx, trip)) throw forbidden();
    tx.delete(tripChecklist).where(eq(tripChecklist.id, row.id)).run();
  });
}

/** For visits: the trip must be visible to the author (null clears the link). */
export function checkTripForVisit(db: DbOrTx, ctx: AuthCtx, tripId: string | null | undefined) {
  if (!tripId) return;
  requireTrip(db, ctx, tripId);
}
