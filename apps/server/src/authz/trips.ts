// The ONLY place that decides who may see or change a trip (DESIGN §3.5,
// §5.5). A trip is visible to its owner, to the app users listed as its people
// and to admins. Seeing a trip never grants anything on its stops: every stop
// still goes through visibleLocationsWhere and serializeLocation.
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { tripPeople, trips } from "../db/schema";
import { can } from "./actions";

const TRUE = sql`1 = 1`;

/** True exactly where ctx may see the trip. AND it into every trip query. */
export function visibleTripsWhere(ctx: AuthCtx, table: typeof trips = trips): SQL {
  if (ctx.role === "admin") return TRUE;
  return or(
    eq(table.ownerId, ctx.userId),
    sql`exists (select 1 from ${tripPeople} where ${and(
      eq(tripPeople.tripId, table.id),
      eq(tripPeople.userId, ctx.userId),
    )})`,
  ) as SQL;
}

/** Fields, stops, people and deletion: the owner (with a writable role) or an admin. */
export const canEditTrip = (ctx: AuthCtx, trip: { ownerId: string }): boolean =>
  ctx.role === "admin" || (trip.ownerId === ctx.userId && can(ctx, "createTrip"));

/** Ticking the packing list: everyone on the trip except guests. */
export const canPackTrip = (ctx: AuthCtx): boolean => ctx.role !== "guest";
