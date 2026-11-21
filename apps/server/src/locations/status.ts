// Effective status of a location (DESIGN §2, §9): `visited` is derived from
// visits, but the latest stored status set AFTER the last visit wins. The
// expression runs in SQL so the list filter and the output cannot disagree.

import type { LocationStatus } from "@trespass/shared/locations/types";
import { eq, type SQL, sql } from "drizzle-orm";
import type { AppDb, DbOrTx } from "../db/client";
import { locations, visits } from "../db/schema";

const LATEST_VISIT = sql`(select max(${visits.createdAt}) from ${visits} where ${visits.locationId} = ${locations.id})`;
const HAS_VISIT = sql`exists (select 1 from ${visits} where ${visits.locationId} = ${locations.id})`;

/**
 * Must be selected from the unaliased `locations` table. Terminal statuses
 * (`sealed`, `redeveloped`, `demolished`) survive a later visit only when they
 * were set after that visit; otherwise any visit makes the status `visited`.
 */
export function effectiveStatusExpr(): SQL<string> {
  return sql<string>`case
    when ${locations.status} in ('sealed', 'redeveloped', 'demolished')
      and (${locations.statusChangedAt} is null or ${LATEST_VISIT} is null or ${locations.statusChangedAt} > ${LATEST_VISIT})
      then ${locations.status}
    when ${HAS_VISIT} then 'visited'
    else ${locations.status}
  end`;
}

/** Strictly increasing ms, so `status_changed_at > last visit` holds even within one millisecond. */
export function statusChangeTime(db: DbOrTx, locationId: string): Date {
  const row = db
    .select({ at: sql<number>`coalesce(max(${visits.createdAt}), 0)` })
    .from(visits)
    .where(eq(visits.locationId, locationId))
    .get();
  return new Date(Math.max(Date.now(), (row?.at ?? 0) + 1));
}

/** A new visit's createdAt, strictly after the last status change/visit. */
export function visitCreateTime(db: DbOrTx, locationId: string): Date {
  const changed = db
    .select({ at: locations.statusChangedAt })
    .from(locations)
    .where(eq(locations.id, locationId))
    .get()?.at;
  const last = db
    .select({ at: sql<number>`coalesce(max(${visits.createdAt}), 0)` })
    .from(visits)
    .where(eq(visits.locationId, locationId))
    .get()?.at;
  return new Date(Math.max(Date.now(), (changed?.getTime() ?? 0) + 1, (last ?? 0) + 1));
}

/** The effective status of one location, for the single-row read path. */
export function effectiveStatusFor(db: AppDb, id: string): LocationStatus {
  const row = db
    .select({ status: effectiveStatusExpr() })
    .from(locations)
    .where(eq(locations.id, id))
    .get();
  return (row?.status ?? "idea") as LocationStatus;
}
