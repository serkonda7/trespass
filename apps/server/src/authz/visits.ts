// The ONLY place that decides who may see or change a visit (DESIGN §3.3,
// §3.4 rule 9). Visibility is an SQL predicate over visits JOIN locations;
// authors always see their own visits, even when the location became invisible.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { eq, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { locations, visits } from "../db/schema";
import { can } from "./actions";
import { atLeast, type Level } from "./levels";
import { visibleLocationsWhere } from "./predicates";

/** Alias for the location joined to a visit query (never the base table). */
export const visitLocation = () => alias(locations, "visit_location");

/**
 * True exactly where a visit is visible: its location is visible at `view` OR
 * the caller wrote it. AND it into every visit query — never filter rows in JS.
 */
export function visibleVisitsWhere(ctx: AuthCtx, table: typeof visits = visits): SQL {
  // Use the base `locations` table inside the subquery: an alias from the outer
  // query cannot be named in an inner FROM (SQLite would look for a real table).
  return sql`(${eq(table.authorId, ctx.userId)} or exists (select 1 from ${locations} where ${eq(
    locations.id,
    table.locationId,
  )} and ${visibleLocationsWhere(ctx, locations)}))`;
}

/** Visibility of a joined location, for the redaction CASE in list queries. */
export function visibleVisitLocationWhere(ctx: AuthCtx, loc = visitLocation()): SQL<number> {
  return sql<number>`${visibleLocationsWhere(ctx, loc)}`;
}

/** Create needs a writable role and at least `contribute` on the location. */
export function canCreateVisit(ctx: AuthCtx, level: Level): boolean {
  return can(ctx, "createLocation") && atLeast(level, "contribute");
}

/** Authors keep edit/delete on their own visit; otherwise location level wins. */
export function canMutateVisit(
  ctx: AuthCtx,
  visit: { authorId: string },
  level: Level,
  action: "edit" | "delete",
): boolean {
  if (ctx.role === "guest") return false;
  if (visit.authorId === ctx.userId) return true;
  return atLeast(level, action === "edit" ? "edit" : "manage");
}
