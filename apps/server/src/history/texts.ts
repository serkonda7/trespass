// Approved history texts per location, for the FTS `history` column. Its own
// module so the search indexer does not import the history service (cycle).
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { history } from "../db/schema";

/** Approved texts of each location, oldest first (FTS `history` column). */
export function approvedHistoryTexts(db: DbOrTx, locationIds: readonly string[]) {
  const out = new Map<string, string[]>();
  if (locationIds.length === 0) return out;
  const rows = db
    .select({ locationId: history.locationId, text: history.text })
    .from(history)
    .where(and(inArray(history.locationId, [...locationIds]), eq(history.status, "approved")))
    .orderBy(asc(history.dateFrom), desc(history.createdAt))
    .all();
  for (const r of rows) out.set(r.locationId, [...(out.get(r.locationId) ?? []), r.text]);
  return out;
}
