// Locations: create, read, update, move, visibility, grants, delete, list and
// duplicate checks. Independent of the request (testable with createTestDb());
// ./functions.ts wraps these as server functions with authMiddleware.
//
// Every permission check goes through src/server/authz. List/map queries AND
// visibleLocationsWhere(ctx) in SQL and take coordinates from visibleLatExpr /
// visibleLonExpr; rows are never filtered in JS. Every response is serialized
// by serializeLocation. Invisible locations are LOCATION_NOT_FOUND (404),
// never LOCATION_FORBIDDEN (DESIGN §3.4).
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { diffFields } from "../../lib/diff";
import { haversineMeters, splitBbox } from "../../lib/geo/distance";
import type { GeoJsonPolygon, Point } from "../../lib/geo/types";
import {
  type CreateLocationInput,
  createLocationInput,
  DEFAULT_PAGE_SIZE,
  DUPLICATE_RADIUS_M,
  type FindDuplicatesInput,
  findDuplicatesInput,
  type GrantInput,
  grantInput,
  type ListLocationsInput,
  listLocationsInput,
  type MoveLocationInput,
  moveLocationInput,
  type RemoveGrantInput,
  removeGrantInput,
  type SetVisibilityInput,
  setVisibilityInput,
  type UpdateLocationInput,
  updateLocationInput,
} from "../../lib/locations/inputs";
import { similarNames } from "../../lib/locations/names";
import type {
  DuplicateMatch,
  GrantRow,
  LocationCategoryRef,
  LocationDetail,
  LocationListItem,
} from "../../lib/locations/types";
import { normalizeSearchText } from "../../lib/normalize";
import { recordEvent } from "../audit";
import {
  atLeast,
  can,
  canSeeExact,
  type Level,
  levelRank,
  loadLocationForCtx,
  locationLevels,
  ROLE_CEILING,
  serializeLocation,
  visibleLatExpr,
  visibleLocationsWhere,
  visibleLonExpr,
} from "../authz";
import type { AuthCtx } from "../authz/ctx";
import type { VisibleLevel } from "../authz/levels";
import type { AppDb, DbOrTx } from "../db/client";
import {
  categories,
  groups,
  type Location,
  locationGrants,
  locations,
  locationTags,
  type NewLocation,
  settings,
  tags,
  users,
} from "../db/schema";
import { fuzzPoint } from "../geo/fuzz";
import { timeZoneForPoint } from "../geo/tz";
import { geocodeEnabled } from "../geocode/reverse";
import { enqueueJob } from "../jobs/queue";
import { conflict, forbidden, LocationsError, notFound, parseInput } from "./errors";

const asDb = (db: DbOrTx) => db as unknown as AppDb;

// --- Loading and versioning -----------------------------------------------------

function requireLocation(db: DbOrTx, ctx: AuthCtx, id: string, min: VisibleLevel = "view") {
  const found = loadLocationForCtx(asDb(db), ctx, id, "view");
  if (!found) throw notFound();
  if (!atLeast(found.level, min)) throw forbidden();
  return found;
}

function assertVersion(location: Pick<Location, "version">, version: number) {
  if (location.version !== version) throw conflict();
}

function writeVersioned(
  db: DbOrTx,
  id: string,
  version: number,
  set: Partial<NewLocation>,
): number {
  const r = db
    .update(locations)
    .set({ ...set, version: version + 1, updatedAt: new Date() })
    .where(and(eq(locations.id, id), eq(locations.version, version)))
    .run() as unknown as { changes: number };
  if (r.changes !== 1) throw conflict();
  return version + 1;
}

const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

// --- Lookups --------------------------------------------------------------------

function requireCategory(db: DbOrTx, id: string) {
  const category = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!category) throw new LocationsError(422, "CATEGORY_INVALID");
  return category;
}

function defaultFuzz(db: DbOrTx): number {
  return (
    db.select({ v: settings.defaultFuzzM }).from(settings).where(eq(settings.id, 1)).get()?.v ??
    1500
  );
}

function enqueueGeocode(db: DbOrTx, locationId: string, point: Point) {
  if (!geocodeEnabled()) return;
  enqueueJob(db, "geocode.reverse", { locationId, lat: point.lat, lon: point.lon });
}

function tagIdsForNames(db: DbOrTx, names: readonly string[]): string[] {
  const normalized = [...new Set(names.map(normalizeSearchText).filter(Boolean))];
  if (normalized.length === 0) return [];
  for (const name of normalized) {
    db.insert(tags).values({ name }).onConflictDoNothing().run();
  }
  return db
    .select({ id: tags.id })
    .from(tags)
    .where(inArray(tags.name, normalized))
    .all()
    .map((r) => r.id)
    .sort();
}

function tagNamesFor(db: DbOrTx, locationId: string): string[] {
  return db
    .select({ name: tags.name })
    .from(locationTags)
    .innerJoin(tags, eq(tags.id, locationTags.tagId))
    .where(eq(locationTags.locationId, locationId))
    .orderBy(asc(tags.name))
    .all()
    .map((r) => r.name);
}

function replaceLocationTags(db: DbOrTx, locationId: string, tagIds: readonly string[]) {
  db.delete(locationTags).where(eq(locationTags.locationId, locationId)).run();
  for (const tagId of tagIds) {
    db.insert(locationTags).values({ locationId, tagId }).onConflictDoNothing().run();
  }
}

function ownerName(db: DbOrTx, userId: string): string | null {
  return (
    db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).get()?.name ??
    null
  );
}

function grantRowsFor(db: DbOrTx, locationId: string): GrantRow[] {
  const rows = db
    .select()
    .from(locationGrants)
    .where(eq(locationGrants.locationId, locationId))
    .all();
  return rows
    .map((g) => {
      const name =
        g.principalKind === "user"
          ? ownerName(db, g.principalId)
          : (db.select({ name: groups.name }).from(groups).where(eq(groups.id, g.principalId)).get()
              ?.name ?? null);
      return {
        principalKind: g.principalKind,
        principalId: g.principalId,
        level: g.level,
        principalName: name ?? g.principalId,
      };
    })
    .sort((a, b) =>
      `${a.principalKind}:${a.principalId}`.localeCompare(`${b.principalKind}:${b.principalId}`),
    );
}

function checkedPrincipal(db: DbOrTx, kind: "user" | "group", id: string) {
  if (kind === "user") {
    const user = db
      .select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!user) throw new LocationsError(422, "GRANT_INVALID", "PRINCIPAL_NOT_FOUND");
    if (user.disabledAt) throw new LocationsError(422, "GRANT_INVALID", "PRINCIPAL_DISABLED");
  } else {
    const group = db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get();
    if (!group) throw new LocationsError(422, "GRANT_INVALID", "PRINCIPAL_NOT_FOUND");
  }
}

function assertGrantCeiling(db: DbOrTx, kind: "user" | "group", id: string, level: Level) {
  if (kind !== "user") return; // groups may contain members of any role
  const role = db.select({ role: users.role }).from(users).where(eq(users.id, id)).get()?.role;
  if (!role) throw new LocationsError(422, "GRANT_INVALID", "PRINCIPAL_NOT_FOUND");
  if (levelRank(level) > levelRank(ROLE_CEILING[role])) {
    throw new LocationsError(403, "GRANT_ABOVE_CEILING");
  }
}

// --- Create ---------------------------------------------------------------------

const CREATE_DIFF_KEYS = [
  "name",
  "description",
  "categoryId",
  "status",
  "visibility",
  "friendsLevel",
] as const satisfies readonly (keyof Location)[];

export function createLocation(
  db: AppDb,
  ctx: AuthCtx,
  raw: CreateLocationInput,
): { id: string; version: number } {
  if (!can(ctx, "createLocation")) throw forbidden();
  const input = parseInput(createLocationInput, raw);
  return db.transaction((tx) => {
    requireCategory(tx, input.categoryId);
    const fuzzRadiusM = input.fuzzRadiusM ?? defaultFuzz(tx);
    if (!Number.isSafeInteger(fuzzRadiusM) || fuzzRadiusM < 0) {
      throw new LocationsError(422, "FUZZ_INVALID");
    }
    const exact: Point = { lat: input.point.lat, lon: input.point.lon };
    const pub = fuzzPoint(exact, fuzzRadiusM);
    const tagRefs = tagIdsForNames(tx, input.tags ?? []);
    const row = tx
      .insert(locations)
      .values({
        ownerId: ctx.userId,
        name: input.name,
        nameSort: normalizeSearchText(input.name),
        description: input.description ?? null,
        categoryId: input.categoryId,
        status: input.status ?? "idea",
        lat: exact.lat,
        lon: exact.lon,
        pubLat: pub.lat,
        pubLon: pub.lon,
        fuzzRadiusM,
        geomArea: (input.geomArea as GeoJsonPolygon | undefined) ?? null,
        parking: input.parking ?? null,
        accessNotes: input.accessNotes ?? null,
        dangerNotes: input.dangerNotes ?? null,
        country: null,
        adminArea: null,
        tz: timeZoneForPoint(exact),
        builtYear: input.builtYear ?? null,
        abandonedYear: input.abandonedYear ?? null,
        visibility: input.visibility ?? "private",
        friendsLevel: input.friendsLevel ?? "view",
      })
      .returning()
      .get();
    replaceLocationTags(tx, row.id, tagRefs);
    const snapshot = pick(row, CREATE_DIFF_KEYS);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "location.created",
      diff: {
        ...diffFields({}, snapshot),
        ...(tagRefs.length ? { tags: { from: null, to: tagNamesFor(tx, row.id) } } : {}),
      },
    });
    enqueueGeocode(tx, row.id, exact);
    return { id: row.id, version: row.version };
  });
}

// --- Read -----------------------------------------------------------------------

function categoryRef(db: DbOrTx, id: string): LocationCategoryRef | null {
  const c = db
    .select({
      id: categories.id,
      key: categories.key,
      name: categories.name,
      icon: categories.icon,
    })
    .from(categories)
    .where(eq(categories.id, id))
    .get();
  return c ?? null;
}

export function getLocation(db: AppDb, ctx: AuthCtx, id: string): LocationDetail {
  const { location, level } = requireLocation(db, ctx, id, "view");
  const category = categoryRef(db, location.categoryId);
  const tags = tagNamesFor(db, location.id);
  const owner = ownerName(db, location.ownerId);
  const grants = atLeast(level, "manage") ? grantRowsFor(db, location.id) : null;
  return {
    location: serializeLocation(location, level, { category, tags, ownerName: owner, grants }),
    category,
    tags,
    ownerName: owner,
    grants,
  };
}

// --- Update ---------------------------------------------------------------------

const EDIT_KEYS = [
  "name",
  "description",
  "categoryId",
  "status",
  "accessNotes",
  "dangerNotes",
  "builtYear",
  "abandonedYear",
] as const satisfies readonly (keyof Location)[];

export function updateLocation(
  db: AppDb,
  ctx: AuthCtx,
  raw: UpdateLocationInput,
): { version: number } {
  const input = parseInput(updateLocationInput, raw);
  return db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, input.id, "edit");
    assertVersion(location, input.version);
    if (input.categoryId !== undefined) requireCategory(tx, input.categoryId);
    const next = {} as Record<string, unknown>;
    for (const key of EDIT_KEYS) if (input[key] !== undefined) next[key] = input[key];
    const before = pick(location, EDIT_KEYS);
    const after = { ...before, ...next };
    const diff = diffFields(before, after);

    let tagChange: { from: string[]; to: string[] } | null = null;
    let tagIds: string[] | null = null;
    if (input.tags !== undefined) {
      const fromNames = tagNamesFor(tx, location.id);
      tagIds = tagIdsForNames(tx, input.tags);
      // The normalized names we are about to store. `tagIdsForNames` only
      // creates missing tags; it does not yet change the location's tag rows.
      const toNames = [...new Set(input.tags.map(normalizeSearchText).filter(Boolean))].sort();
      const changed = fromNames.join("\u0000") !== toNames.join("\u0000");
      if (changed) tagChange = { from: fromNames, to: toNames };
      else tagIds = null;
    }
    if (Object.keys(diff).length === 0 && !tagChange) return { version: location.version };

    if (next.name !== undefined) next.nameSort = normalizeSearchText(String(next.name));
    const version = writeVersioned(tx, location.id, location.version, next as Partial<NewLocation>);
    if (tagIds) replaceLocationTags(tx, location.id, tagIds);
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: location.id,
      action: "location.updated",
      diff: { ...diff, ...(tagChange ? { tags: tagChange } : {}) },
    });
    return { version };
  });
}

// --- Move -----------------------------------------------------------------------

export function moveLocation(db: AppDb, ctx: AuthCtx, raw: MoveLocationInput): { version: number } {
  const input = parseInput(moveLocationInput, raw);
  return db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, input.id, "edit");
    assertVersion(location, input.version);
    const fuzzRadiusM = input.fuzzRadiusM ?? location.fuzzRadiusM;
    if (!Number.isSafeInteger(fuzzRadiusM) || fuzzRadiusM < 0) {
      throw new LocationsError(422, "FUZZ_INVALID");
    }
    const exact: Point = { lat: input.point.lat, lon: input.point.lon };
    const exactChanged = exact.lat !== location.lat || exact.lon !== location.lon;
    const radiusChanged = fuzzRadiusM !== location.fuzzRadiusM;
    if (!exactChanged && !radiusChanged) return { version: location.version };

    const oldPub: Point = { lat: location.pubLat, lon: location.pubLon };
    // Keep the old public point while it still covers the new exact point;
    // otherwise (or when the radius changed) generate a fresh one.
    const pub =
      !radiusChanged && haversineMeters(exact, oldPub) <= fuzzRadiusM
        ? oldPub
        : fuzzPoint(exact, fuzzRadiusM);

    const version = writeVersioned(tx, location.id, location.version, {
      lat: exact.lat,
      lon: exact.lon,
      pubLat: pub.lat,
      pubLon: pub.lon,
      fuzzRadiusM,
      tz: timeZoneForPoint(exact),
    });
    // Never log the old or the new coordinates, for anyone below precise.
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: location.id,
      action: "location.moved",
      diff: { coords: { from: "changed", to: "changed" } },
    });
    enqueueGeocode(tx, location.id, exact);
    return { version };
  });
}

// --- Visibility and grants ------------------------------------------------------

export function setVisibility(
  db: AppDb,
  ctx: AuthCtx,
  raw: SetVisibilityInput,
): { version: number } {
  const input = parseInput(setVisibilityInput, raw);
  return db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, input.id, "manage");
    assertVersion(location, input.version);
    const before = pick(location, ["visibility", "friendsLevel"] as const);
    const after = { visibility: input.visibility, friendsLevel: input.friendsLevel };
    const version = writeVersioned(tx, location.id, location.version, after);
    const diff = diffFields(before, after);
    if (Object.keys(diff).length > 0) {
      recordEvent(tx, {
        actorId: ctx.userId,
        entityId: location.id,
        action: "location.visibility",
        diff,
      });
    }
    return { version };
  });
}

export function listLocationGrants(db: AppDb, ctx: AuthCtx, locationId: string): GrantRow[] {
  requireLocation(db, ctx, locationId, "manage");
  return grantRowsFor(db, locationId);
}

export function setLocationGrant(db: AppDb, ctx: AuthCtx, raw: GrantInput): GrantRow[] {
  const input = parseInput(grantInput, raw);
  return db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, input.locationId, "manage");
    checkedPrincipal(tx, input.principalKind, input.principalId);
    assertGrantCeiling(tx, input.principalKind, input.principalId, input.level);
    const before = grantRowsFor(tx, location.id);
    tx.insert(locationGrants)
      .values({
        locationId: location.id,
        principalKind: input.principalKind,
        principalId: input.principalId,
        level: input.level,
      })
      .onConflictDoUpdate({
        target: [
          locationGrants.locationId,
          locationGrants.principalKind,
          locationGrants.principalId,
        ],
        set: { level: input.level },
      })
      .run();
    writeVersioned(tx, location.id, location.version, {});
    const after = grantRowsFor(tx, location.id);
    const key = `${input.principalKind}:${input.principalId}`;
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: location.id,
      action: "location.grant",
      diff: {
        [key]: {
          from: before.find((g) => `${g.principalKind}:${g.principalId}` === key)?.level ?? null,
          to: input.level,
        },
      },
    });
    return after;
  });
}

export function removeLocationGrant(db: AppDb, ctx: AuthCtx, raw: RemoveGrantInput): GrantRow[] {
  const input = parseInput(removeGrantInput, raw);
  return db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, input.locationId, "manage");
    const before = grantRowsFor(tx, location.id);
    const key = `${input.principalKind}:${input.principalId}`;
    tx.delete(locationGrants)
      .where(
        and(
          eq(locationGrants.locationId, location.id),
          eq(locationGrants.principalKind, input.principalKind),
          eq(locationGrants.principalId, input.principalId),
        ),
      )
      .run();
    writeVersioned(tx, location.id, location.version, {});
    if (before.some((g) => `${g.principalKind}:${g.principalId}` === key)) {
      recordEvent(tx, {
        actorId: ctx.userId,
        entityId: location.id,
        action: "location.grant",
        diff: { [key]: { from: input.principalKind, to: null } },
      });
    }
    return grantRowsFor(tx, location.id);
  });
}

export function deleteLocation(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const { location } = requireLocation(tx, ctx, id, "manage");
    recordEvent(tx, { actorId: ctx.userId, entityId: location.id, action: "location.deleted" });
    tx.delete(locations).where(eq(locations.id, location.id)).run();
  });
}

// --- List -----------------------------------------------------------------------

type Cursor = { id: string; dist?: number };

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Cursor).id === "string" &&
      ((value as Cursor).dist === undefined || typeof (value as Cursor).dist === "number")
    ) {
      return value as Cursor;
    }
  } catch {
    // Fall through to the explicit error.
  }
  throw new LocationsError(422, "CURSOR_INVALID");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export type LocationList = { rows: LocationListItem[]; nextCursor: string | null };

export function listLocations(db: AppDb, ctx: AuthCtx, raw: ListLocationsInput): LocationList {
  const input = parseInput(listLocationsInput, raw);
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(input.cursor);
  const conditions: SQL[] = [visibleLocationsWhere(ctx)];
  if (input.status?.length) conditions.push(inArray(locations.status, input.status));
  if (input.categoryId?.length) conditions.push(inArray(locations.categoryId, input.categoryId));
  if (input.country?.length) conditions.push(inArray(locations.country, input.country));
  if (input.tag?.length) {
    const names = input.tag.map(normalizeSearchText);
    conditions.push(
      sql`exists (select 1 from ${locationTags} inner join ${tags} on ${eq(
        tags.id,
        locationTags.tagId,
      )} where ${eq(locationTags.locationId, locations.id)} and ${inArray(tags.name, names)})`,
    );
  }
  if (input.q)
    conditions.push(sql`${locations.nameSort} like ${`%${normalizeSearchText(input.q)}%`}`);

  const latExpr = visibleLatExpr(ctx);
  const lonExpr = visibleLonExpr(ctx);
  if (input.bbox) {
    const boxes = splitBbox(input.bbox);
    const boxConditions = boxes.map(
      (b) =>
        and(
          sql`${latExpr} between ${b.minLat} and ${b.maxLat}`,
          sql`${lonExpr} between ${b.minLon} and ${b.maxLon}`,
        ) as SQL,
    );
    conditions.push(or(...boxConditions) as SQL);
  }

  // Equirectangular approximation in SQL, over the VISIBLE coordinates only:
  // a distance sort must not leak the exact point (DESIGN §3.4 rule 2).
  let distSq: SQL | null = null;
  if (input.near) {
    const metersPerLon = 111_320 * Math.cos((input.near.lat * Math.PI) / 180);
    const dx = sql`((${lonExpr} - ${input.near.lon}) * ${metersPerLon})`;
    const dy = sql`((${latExpr} - ${input.near.lat}) * ${111_320})`;
    distSq = sql`(${dx} * ${dx} + ${dy} * ${dy})`;
    if (cursor?.dist !== undefined) {
      conditions.push(
        sql`(${distSq} > ${cursor.dist} or (${distSq} = ${cursor.dist} and ${locations.id} > ${cursor.id}))`,
      );
    } else if (cursor) {
      conditions.push(sql`${locations.id} > ${cursor.id}`);
    }
  } else if (cursor) {
    conditions.push(sql`${locations.id} > ${cursor.id}`);
  }

  const rows = db
    .select({
      id: locations.id,
      name: locations.name,
      categoryId: locations.categoryId,
      status: locations.status,
      country: locations.country,
      ownerId: locations.ownerId,
      visibility: locations.visibility,
      friendsLevel: locations.friendsLevel,
      visibleLat: sql<number>`${latExpr}`.as("visible_lat"),
      visibleLon: sql<number>`${lonExpr}`.as("visible_lon"),
      visibleDistSq: distSq
        ? sql<number>`${distSq}`.as("visible_dist_sq")
        : sql<number>`NULL`.as("visible_dist_sq"),
    })
    .from(locations)
    .where(and(...conditions))
    .orderBy(...(distSq ? [sql`${distSq} asc`, asc(locations.id)] : [asc(locations.id)]))
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const levels = locationLevels(db, ctx, page);
  const catRows = db
    .select({
      id: categories.id,
      key: categories.key,
      icon: categories.icon,
    })
    .from(categories)
    .all();
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const out: LocationListItem[] = [];
  for (const row of page) {
    const level = levels.get(row.id);
    if (level === undefined || level === "none") continue; // safety net, not a filter
    const cat = catById.get(row.categoryId);
    out.push({
      id: row.id,
      name: row.name,
      categoryKey: cat?.key ?? "",
      categoryIcon: cat?.icon ?? "",
      status: row.status,
      point: { lat: row.visibleLat, lon: row.visibleLon },
      exact: canSeeExact(level),
      level: level as VisibleLevel,
      country: row.country,
    });
  }
  let nextCursor: string | null = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    const lastRow = rows[page.length - 1];
    nextCursor = encodeCursor({
      id: last.id,
      ...(distSq && lastRow.visibleDistSq != null ? { dist: lastRow.visibleDistSq } : {}),
    });
  }
  return { rows: out, nextCursor };
}

// --- Duplicates -----------------------------------------------------------------

export function findDuplicates(
  db: AppDb,
  ctx: AuthCtx,
  raw: FindDuplicatesInput,
): DuplicateMatch[] {
  const input = parseInput(findDuplicatesInput, raw);
  const normalizedName = normalizeSearchText(input.name);
  const metersPerLon = 111_320 * Math.cos((input.point.lat * Math.PI) / 180);
  const latExpr = visibleLatExpr(ctx);
  const lonExpr = visibleLonExpr(ctx);
  const dx = sql`((${lonExpr} - ${input.point.lon}) * ${metersPerLon})`;
  const dy = sql`((${latExpr} - ${input.point.lat}) * ${111_320})`;
  const distSq = sql`(${dx} * ${dx} + ${dy} * ${dy})`;
  const rows = db
    .select({
      id: locations.id,
      name: locations.name,
      visibleLat: sql<number>`${latExpr}`.as("visible_lat"),
      visibleLon: sql<number>`${lonExpr}`.as("visible_lon"),
      distSq: sql<number>`${distSq}`.as("dist_sq"),
    })
    .from(locations)
    .where(
      and(
        visibleLocationsWhere(ctx),
        or(
          sql`${distSq} <= ${DUPLICATE_RADIUS_M ** 2}`,
          sql`${locations.nameSort} like ${`%${normalizedName}%`}`,
          sql`${normalizedName} like '%' || ${locations.nameSort} || '%'`,
        ) as SQL,
      ),
    )
    .orderBy(asc(locations.id))
    .limit(DUPLICATE_RADIUS_M)
    .all();
  return rows
    .filter((r) => r.distSq <= DUPLICATE_RADIUS_M ** 2 || similarNames(input.name, r.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      point: { lat: r.visibleLat, lon: r.visibleLon },
      reason: r.distSq <= DUPLICATE_RADIUS_M ** 2 ? ("nearby" as const) : ("similar_name" as const),
    }));
}
