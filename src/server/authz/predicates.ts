// SQL predicates over `locations` that mirror `locationLevel` (./levels.ts)
// exactly. Every list, search, map and export query ANDs one of these in
// (DESIGN §3.4 rule 3); nothing filters locations in JS. The predicates never
// evaluate to NULL, so `not(...)` gives the exact complement.
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { locationGrants, locations } from "../db/schema";
import type { AuthCtx } from "./ctx";
import {
  atLeast,
  friendLevelsAtLeast,
  grantLevelsAtLeast,
  ROLE_CEILING,
  type VisibleLevel,
} from "./levels";

/** `locations` or an alias of it (`alias(locations, "l")`), for self-joins. */
export type LocationsTableLike = {
  id: AnySQLiteColumn;
  ownerId: AnySQLiteColumn;
  visibility: AnySQLiteColumn;
  friendsLevel: AnySQLiteColumn;
  lat: AnySQLiteColumn;
  lon: AnySQLiteColumn;
  pubLat: AnySQLiteColumn;
  pubLon: AnySQLiteColumn;
};

const TRUE = sql`1 = 1`;
const FALSE = sql`1 = 0`;

/** Locations are always owned by a single user. Never NULL (owner_id is NOT NULL). */
function ownsWhere(ctx: AuthCtx, t: LocationsTableLike): SQL {
  return eq(t.ownerId, ctx.userId) as SQL;
}

/** Some grant on the location gives ctx (directly or via a group) at least `min`. */
function grantAtLeastWhere(ctx: AuthCtx, min: VisibleLevel, t: LocationsTableLike): SQL {
  const gids = [...ctx.groupIds];
  const toMe = and(
    eq(locationGrants.principalKind, "user"),
    eq(locationGrants.principalId, ctx.userId),
  );
  const principal =
    gids.length === 0
      ? toMe
      : or(
          toMe,
          and(eq(locationGrants.principalKind, "group"), inArray(locationGrants.principalId, gids)),
        );
  return sql`exists (select 1 from ${locationGrants} where ${locationGrants.locationId} = ${t.id} and ${inArray(
    locationGrants.level,
    grantLevelsAtLeast(min),
  )} and ${principal})`;
}

/**
 * True exactly where `locationLevel(ctx, loc, grants) >= min`. `min` starts at
 * `view`; the role ceiling caps everything, including ownership and grants.
 * The `friends_level` comparison happens in SQL (never fetched and compared in
 * JS), so a low viewer cannot use a bbox or a distance sort as an oracle.
 */
export function locationsAtLeastWhere(
  ctx: AuthCtx,
  min: VisibleLevel,
  table: LocationsTableLike = locations,
): SQL {
  if (ctx.role === "admin") return TRUE;
  if (!atLeast(ROLE_CEILING[ctx.role], min)) return FALSE;

  const parts: SQL[] = [ownsWhere(ctx, table)];
  // "friends": members get friends_level; guests the same, capped at view by
  // the ceiling above. `friends_level` lives in the table, so compare in SQL.
  const friendLevels = friendLevelsAtLeast(min);
  if (friendLevels.length > 0) {
    parts.push(
      and(eq(table.visibility, "friends"), inArray(table.friendsLevel, friendLevels)) as SQL,
    );
  }
  parts.push(grantAtLeastWhere(ctx, min, table));
  return sql`(${or(...parts)})`;
}

/** Locations ctx can see (level >= view). AND it into every location query. */
export function visibleLocationsWhere(ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  return locationsAtLeastWhere(ctx, "view", table);
}

/** Locations whose exact point ctx may see. Use for any exact-coordinate query. */
export function preciseWhere(ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  return locationsAtLeastWhere(ctx, "precise", table);
}
