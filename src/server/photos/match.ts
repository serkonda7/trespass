// GPS/timestamp auto-matching only SUGGESTS a location and a visit; it never
// attaches them. Candidates are filtered in SQL with the UPLOADER's visible
// coordinates (DESIGN §3.4 rule 2): using exact coordinates here would let a
// fake-GPS upload triangulate hidden points. A viewer below `precise` whose
// photo GPS equals the exact point but is >300 m from the fuzzed point gets no
// suggestion.
import { and, between, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { localDateTimeToUtc, todayInTz } from "../../lib/format";
import { bboxAround, haversineMeters, splitBbox } from "../../lib/geo/distance";
import { loadAuthCtx } from "../auth/users";
import { visibleLatExpr, visibleLonExpr, visibleVisitsWhere } from "../authz";
import type { AppDb } from "../db/client";
import { locations, photos, visits } from "../db/schema";

const MATCH_RADIUS_M = 300;

export type PhotoMatch = {
  locationId: string;
  locationName: string;
  visitId: string | null;
  visitedOn: string | null;
};

/**
 * Stores a suggestion for one processed photo (or clears stale ones). Called by
 * the `photos.process` job after EXIF extraction and derivative creation.
 */
export function suggestPhotoMatches(
  db: AppDb,
  photoId: string,
  gps: { lat: number; lon: number } | null,
  takenAt: Date | null,
  takenLocal?: string | null,
  offset?: string | null,
  signal?: AbortSignal,
): PhotoMatch | null {
  const photo = db.select().from(photos).where(eq(photos.id, photoId)).get();
  if (!photo) return null;
  const ctx = loadAuthCtx(db, photo.uploaderId);
  if (!ctx || !gps || photo.locationId || photo.visitId) {
    if (photo.suggestedLocationId || photo.suggestedVisitId) {
      db.update(photos)
        .set({ suggestedLocationId: null, suggestedVisitId: null })
        .where(eq(photos.id, photoId))
        .run();
    }
    return null;
  }

  const loc = alias(locations, "photo_match_location");
  const latExpr = visibleLatExpr(ctx, loc);
  const lonExpr = visibleLonExpr(ctx, loc);
  const boxes = splitBbox(bboxAround(gps, MATCH_RADIUS_M));
  const inBox: SQL = or(
    ...boxes.map(
      (box) =>
        and(
          between(latExpr, box.minLat, box.maxLat),
          between(lonExpr, box.minLon, box.maxLon),
        ) as SQL,
    ),
  ) as SQL;
  const candidates = db
    .select({
      id: loc.id,
      name: loc.name,
      tz: loc.tz,
      lat: sql<number>`${latExpr}`,
      lon: sql<number>`${lonExpr}`,
    })
    .from(loc)
    .where(inBox)
    .all();

  let nearest: (typeof candidates)[number] | undefined;
  let nearestM = Number.POSITIVE_INFINITY;
  for (const row of candidates) {
    if (signal?.aborted) return null;
    const d = haversineMeters(gps, { lat: row.lat, lon: row.lon });
    if (d <= MATCH_RADIUS_M && d < nearestM) {
      nearest = row;
      nearestM = d;
    }
  }
  if (!nearest) return null;

  // The naive camera clock is interpreted in the matched location's zone.
  const set: Partial<typeof photos.$inferInsert> = {};
  if (takenLocal && !offset) set.takenAt = localDateTimeToUtc(takenLocal, nearest.tz);

  let visitId: string | null = null;
  let visitedOn: string | null = null;
  if (takenAt) {
    const day = todayInTz(nearest.tz, takenAt);
    const visit = db
      .select({ id: visits.id, visitedOn: visits.visitedOn })
      .from(visits)
      .where(
        and(
          eq(visits.locationId, nearest.id),
          eq(visits.visitedOn, day),
          visibleVisitsWhere(ctx, visits),
        ),
      )
      .get();
    if (visit) {
      visitId = visit.id;
      visitedOn = visit.visitedOn;
    }
  }
  set.suggestedLocationId = nearest.id;
  set.suggestedVisitId = visitId;
  db.update(photos).set(set).where(eq(photos.id, photoId)).run();
  return { locationId: nearest.id, locationName: nearest.name, visitId, visitedOn };
}
