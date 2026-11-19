// Loading locations together with the caller's level. "Cannot see" and "does
// not exist" are the same answer (null / 404, never 403 for invisibility;
// DESIGN §3.4 rule 9).

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { HttpError } from "../auth/context";
import type { AppDb } from "../db/client";
import { type Location, locationGrants, locations } from "../db/schema";
import {
  atLeast,
  type GrantRef,
  type Level,
  type LocationAuthFields,
  locationLevel,
  type VisibleLevel,
} from "./levels";

export type LeveledLocation<T = Location> = { location: T; level: VisibleLevel };

/** location_grants rows that can apply to ctx (to the user, or to one of its groups). */
function grantsForCtxWhere(ctx: AuthCtx): SQL {
  const toMe = and(
    eq(locationGrants.principalKind, "user"),
    eq(locationGrants.principalId, ctx.userId),
  );
  const gids = [...ctx.groupIds];
  if (gids.length === 0) return toMe as SQL;
  return or(
    toMe,
    and(eq(locationGrants.principalKind, "group"), inArray(locationGrants.principalId, gids)),
  ) as SQL;
}

// Keeps the number of bound parameters well below SQLite's limit.
const CHUNK = 500;

/** The ctx-relevant grants of the given locations, grouped by location id. */
function loadGrants(db: AppDb, ctx: AuthCtx, locationIds: readonly string[]) {
  const byLocation = new Map<string, GrantRef[]>();
  const ids = [...new Set(locationIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = db
      .select({
        locationId: locationGrants.locationId,
        principalKind: locationGrants.principalKind,
        principalId: locationGrants.principalId,
        level: locationGrants.level,
      })
      .from(locationGrants)
      .where(
        and(inArray(locationGrants.locationId, ids.slice(i, i + CHUNK)), grantsForCtxWhere(ctx)),
      )
      .all();
    for (const r of rows) {
      const list = byLocation.get(r.locationId);
      if (list) list.push(r);
      else byLocation.set(r.locationId, [r]);
    }
  }
  return byLocation;
}

/**
 * The caller's level for each of a page of already-loaded locations, keyed by
 * id, with one grants query per 500 rows (none for admins).
 */
export function locationLevels(
  db: AppDb,
  ctx: AuthCtx,
  rows: readonly LocationAuthFields[],
): Map<string, Level> {
  const out = new Map<string, Level>();
  if (rows.length === 0) return out;
  const grants =
    ctx.role === "admin"
      ? new Map<string, GrantRef[]>()
      : loadGrants(
          db,
          ctx,
          rows.map((r) => r.id),
        );
  for (const r of rows) out.set(r.id, locationLevel(ctx, r, grants.get(r.id) ?? []));
  return out;
}

/**
 * Pairs each row with the caller's level, dropping rows below `min`. Rows from
 * a query that ANDed `visibleLocationsWhere(ctx)` are never dropped at `view`;
 * the drop is a safety net, not a filter (filter in SQL).
 */
export function withLevels<T extends LocationAuthFields>(
  db: AppDb,
  ctx: AuthCtx,
  rows: readonly T[],
  min: VisibleLevel = "view",
): LeveledLocation<T>[] {
  const levels = locationLevels(db, ctx, rows);
  const out: LeveledLocation<T>[] = [];
  for (const location of rows) {
    const level = levels.get(location.id) ?? "none";
    if (level !== "none" && atLeast(level, min)) out.push({ location, level });
  }
  return out;
}

/**
 * Loads one location with the caller's level. Returns null when it does not
 * exist or the caller's level is below `min`; callers answer both with 404.
 */
export function loadLocationForCtx(
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
  min: VisibleLevel = "view",
): LeveledLocation | null {
  const location = db.select().from(locations).where(eq(locations.id, locationId)).get();
  if (!location) return null;
  const level = locationLevels(db, ctx, [location]).get(location.id) ?? "none";
  if (level === "none" || !atLeast(level, min)) return null;
  return { location, level };
}

/**
 * For server functions: 404 when the caller cannot see the location (or it
 * does not exist), 403 when it can see it but its level is below `min`.
 */
export function requireLocationForCtx(
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
  min: VisibleLevel = "view",
): LeveledLocation {
  const found = loadLocationForCtx(db, ctx, locationId, "view");
  if (!found) throw new HttpError(404, "Not found");
  if (!atLeast(found.level, min)) throw new HttpError(403, "Forbidden");
  return found;
}
