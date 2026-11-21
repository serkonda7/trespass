// The ONE source of coordinates for every location query (DESIGN §3.4 rule 2).
// Every visible location is returned at its exact point; these expressions keep
// a single place for queries to take coordinates from.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { type SQL, sql } from "drizzle-orm";
import { locations } from "../db/schema";
import type { LocationsTableLike } from "./predicates";

/** Exact latitude. Kept as an expression so every query uses the same source. */
export function visibleLatExpr(_ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  return sql`${table.lat}`;
}

/** Exact longitude. Kept as an expression so every query uses the same source. */
export function visibleLonExpr(_ctx: AuthCtx, table: LocationsTableLike = locations): SQL {
  return sql`${table.lon}`;
}
