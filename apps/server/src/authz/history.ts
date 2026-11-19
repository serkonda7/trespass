// The ONLY place that decides who may see or change history entries (DESIGN
// §3.2, §5.4). Approved entries inherit their location's `view`; drafts (e.g.
// research facts awaiting review) need `edit`. Filter in SQL only.
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { history, locations } from "../db/schema";
import { atLeast, type Level } from "./levels";
import { locationsAtLeastWhere, visibleLocationsWhere } from "./predicates";

/** True exactly where a history entry is visible to ctx. AND it into every history query. */
export function visibleHistoryWhere(ctx: AuthCtx, table: typeof history = history): SQL {
  return sql`exists (select 1 from ${locations} where ${eq(locations.id, table.locationId)} and ((${and(
    eq(table.status, "approved"),
    visibleLocationsWhere(ctx, locations),
  )}) or ${locationsAtLeastWhere(ctx, "edit", locations)}))`;
}

/** Create, change, approve and delete history and sources: `edit` on the location. */
export const canEditHistory = (ctx: AuthCtx, level: Level): boolean =>
  ctx.role !== "guest" && atLeast(level, "edit");
