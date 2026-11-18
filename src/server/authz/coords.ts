// The ONE source of coordinates for every location query (DESIGN §3.4 rule 2).
// Filtering, sorting or returning coordinates without these expressions would
// turn a tiny bounding box or a "near me" sort into an oracle for the real point.
import { type SQL, sql } from "drizzle-orm";
import { locations } from "../db/schema";
import type { AuthCtx } from "./ctx";
import { type LocationsTableLike, preciseWhere } from "./predicates";

/** `CASE WHEN level >= precise THEN exact ELSE fuzzed END` for latitude. */
export function visibleLatExpr(ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  const precise = preciseWhere(ctx, table);
  return sql`(case when ${precise} then ${table.lat} else ${table.pubLat} end)`;
}

/** `CASE WHEN level >= precise THEN exact ELSE fuzzed END` for longitude. */
export function visibleLonExpr(ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  const precise = preciseWhere(ctx, table);
  return sql`(case when ${precise} then ${table.lon} else ${table.pubLon} end)`;
}
