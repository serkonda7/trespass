// The start page's numbers. Nothing here filters in JS: counts use the same
// SQL predicates as the map, the journal and the trips list, and rows come
// from those services' own serializers.

import { can } from "@trespass/shared/app-actions";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type { Dashboard } from "@trespass/shared/dashboard/types";
import type { LocationStatus } from "@trespass/shared/locations/types";
import { and, count, eq, isNull } from "drizzle-orm";
import { visibleLocationsWhere } from "../authz/predicates";
import type { AppDb } from "../db/client";
import { candidates, locations, photos } from "../db/schema";
import { effectiveStatusExpr } from "../locations/status";
import { listTrips } from "../trips/service";
import { listFeed, yearReview } from "../visits/service";

const STATUSES: readonly LocationStatus[] = [
  "idea",
  "researched",
  "planned",
  "visited",
  "sealed",
  "redeveloped",
  "demolished",
];

export const DASHBOARD_RECENT_VISITS = 5;
export const DASHBOARD_OPEN_TRIPS = 3;

export function getDashboard(db: AppDb, ctx: AuthCtx, now: Date = new Date()): Dashboard {
  const status = effectiveStatusExpr();
  const statusRows = db
    .select({ status, n: count() })
    .from(locations)
    .where(visibleLocationsWhere(ctx))
    .groupBy(status)
    .all();
  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    LocationStatus,
    number
  >;
  for (const row of statusRows) {
    if (row.status in statusCounts) statusCounts[row.status as LocationStatus] = row.n;
  }

  // Unsorted means "attached to nothing"; only the uploader sees them as theirs.
  const unsortedPhotos =
    db
      .select({ n: count() })
      .from(photos)
      .where(
        and(eq(photos.uploaderId, ctx.userId), isNull(photos.locationId), isNull(photos.visitId)),
      )
      .get()?.n ?? 0;

  const out: Dashboard = {
    locations: statusRows.reduce((sum, r) => sum + r.n, 0),
    statusCounts,
    unsortedPhotos,
    year: yearReview(db, ctx, { year: now.getFullYear() }),
    recentVisits: listFeed(db, ctx, { limit: DASHBOARD_RECENT_VISITS }).rows,
    openTrips: listTrips(db, ctx, { open: true }).slice(0, DASHBOARD_OPEN_TRIPS),
  };
  if (can(ctx, "research")) {
    out.researchInbox =
      db.select({ n: count() }).from(candidates).where(eq(candidates.status, "inbox")).get()?.n ??
      0;
  }
  return out;
}
