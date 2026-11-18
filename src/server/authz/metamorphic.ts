// Reusable metamorphic-test helper (DESIGN §3.4 rule 5). Captures the JSON of
// every endpoint that returns location data, then the caller changes only the
// exact lat/lon in the database; all responses for a viewer below `precise`
// must stay byte-identical. Later stages can add endpoints via `extra`.
// This is test-only code; no app module imports it.
import { bboxAround } from "../../lib/geo/distance";
import type { Point } from "../../lib/geo/types";
import type { AppDb } from "../db/client";
import { findDuplicates, getLocation, listLocations } from "../locations/service";
import {
  getLocationTimeline,
  listFeed,
  listVisitsForLocation,
  yearReview,
} from "../visits/service";
import type { AuthCtx } from "./ctx";

export type ExtraProbe = (
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Stage 4 probes: every journal endpoint that returns location data. Pass as
 * `extra` to captureLocationResponses after creating a visit on the location.
 */
export const visitProbes: ExtraProbe = (db, ctx, locationId) => ({
  listVisitsForLocation: listVisitsForLocation(db, ctx, locationId),
  listFeed: listFeed(db, ctx, { limit: 100 }),
  yearReview: yearReview(db, ctx, { year: new Date().getUTCFullYear() }),
  getLocationTimeline: getLocationTimeline(db, ctx, locationId),
});

/** Captures one JSON string per endpoint, keyed by a stable name. */
export async function captureLocationResponses(
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
  opts: { exact?: Point; extra?: ExtraProbe } = {},
): Promise<Record<string, string>> {
  const detail = getLocation(db, ctx, locationId);
  // The caller's visible point: the fuzzed one below `precise`.
  const visible: Point = { lat: detail.location.point.lat, lon: detail.location.point.lon };
  // The real exact point is only known to the test; `precise` viewers would
  // already see it. Passing it lets the tiny bbox / near-me probes attack the
  // real coordinates even though the viewer must not be able to use them.
  const exact: Point = opts.exact ?? visible;
  const snapshot: Record<string, unknown> = {
    getLocation: detail,
    list: listLocations(db, ctx, {}),
    bboxPub: listLocations(db, ctx, { bbox: bboxAround(visible, 1000) }),
    bboxExact: listLocations(db, ctx, { bbox: bboxAround(exact, 5) }),
    nearExact: listLocations(db, ctx, {
      near: { lat: exact.lat + 0.0001, lon: exact.lon + 0.0001 },
    }),
    findDuplicates: findDuplicates(db, ctx, { point: exact, name: detail.location.name }),
  };
  if (opts.extra) Object.assign(snapshot, await opts.extra(db, ctx, locationId));
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key, JSON.stringify(value)]),
  );
}

/**
 * Captures before/after snapshots while changing ONLY the exact coordinates.
 * Does not touch the fuzz point, version, timestamps or any other column.
 */
export async function runMetamorphicPrivacyCheck(
  db: AppDb,
  ctx: AuthCtx,
  locationId: string,
  newExact: Point,
  opts: { exact?: Point; extra?: ExtraProbe } = {},
): Promise<{ before: Record<string, string>; after: Record<string, string> }> {
  const before = await captureLocationResponses(db, ctx, locationId, opts);
  // Raw SQL on purpose: Drizzle would fire the `$onUpdateFn` on updated_at,
  // which would change unrelated response bytes. Only lat/lon are touched.
  db.$client
    .query("UPDATE locations SET lat = ?, lon = ? WHERE id = ?")
    .run(newExact.lat, newExact.lon, locationId);
  const after = await captureLocationResponses(db, ctx, locationId, opts);
  return { before, after };
}
