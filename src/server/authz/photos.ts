// The ONLY place that decides who may see or change a photo (DESIGN §3.3,
// §3.4 rules 4 & 6, §5.3). Visibility is an SQL predicate over photos joined to
// locations and visits; rows are never filtered in JS. Authors keep their own
// photos even after the location became invisible. Unsorted photos (no location
// and no visit) are visible only to their uploader and admins.
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { locations, photos, visits } from "../db/schema";
import type { AuthCtx } from "./ctx";
import { atLeast, type Level } from "./levels";
import {
  type LocationsTableLike,
  locationsAtLeastWhere,
  visibleLocationsWhere,
} from "./predicates";
import { canMutateVisit, visibleVisitsWhere } from "./visits";

const TRUE = sql`1 = 1`;

/** `photos` or an alias of it, for self-joins. */
export type PhotosTableLike = {
  id: AnySQLiteColumn;
  uploaderId: AnySQLiteColumn;
  locationId: AnySQLiteColumn;
  visitId: AnySQLiteColumn;
};

/**
 * True exactly where a photo is visible. AND it into every photo query — never
 * filter rows in JS. A photo inherits its location's (or visit's) visibility;
 * the uploader and admins always see their own photos, including unsorted ones.
 */
export function visiblePhotosWhere(ctx: AuthCtx, table: PhotosTableLike = photos): SQL {
  const parts: SQL[] = [eq(table.uploaderId, ctx.userId) as SQL];
  if (ctx.role === "admin") parts.push(TRUE);
  parts.push(
    sql`exists (select 1 from ${locations} where ${eq(locations.id, table.locationId)} and ${visibleLocationsWhere(ctx, locations)})`,
  );
  parts.push(
    sql`exists (select 1 from ${visits} where ${eq(visits.id, table.visitId)} and ${visibleVisitsWhere(ctx, visits)})`,
  );
  return or(...parts) as SQL;
}

/** Photos attached to a location the caller sees at `min` (SQL only). */
export function photosAtLeastWhere(
  ctx: AuthCtx,
  min: Exclude<Level, "none">,
  table: PhotosTableLike = photos,
): SQL {
  if (ctx.role === "admin") return TRUE;
  return sql`exists (select 1 from ${locations} where ${eq(locations.id, table.locationId)} and ${locationsAtLeastWhere(ctx, min, locations)})`;
}

/** Batch visibility check for journal embeds (one SQL query, never JS filtering). */
export function visiblePhotoIdsWhere(ctx: AuthCtx, ids: readonly string[]): SQL {
  return and(inArray(photos.id, ids), visiblePhotosWhere(ctx, photos)) as SQL;
}

/** 1 when the photo's location is visible, else 0 (for the DTO's redaction). */
export function photoLocationVisibleWhere(
  ctx: AuthCtx,
  loc: LocationsTableLike = locations,
): SQL<number> {
  return sql<number>`(case when ${loc.id} is not null and ${visibleLocationsWhere(ctx, loc)} then 1 else 0 end)`;
}

/** 1 when the photo's visit is visible, else 0 (for the DTO's redaction). */
export function photoVisitVisibleWhere(ctx: AuthCtx, table: PhotosTableLike = photos): SQL<number> {
  return sql<number>`(case when exists (select 1 from ${visits} where ${eq(visits.id, table.visitId)} and ${visibleVisitsWhere(ctx, visits)}) then 1 else 0 end)`;
}

// --- Per-photo decisions (after an SQL-filtered row was loaded) ---------------

const isAdmin = (ctx: AuthCtx) => ctx.role === "admin";
const isUploader = (ctx: AuthCtx, photo: { uploaderId: string }) => photo.uploaderId === ctx.userId;

/** Exact GPS and GPS-derived suggestions need uploader, admin or `precise`. */
export function canSeePhotoGps(
  ctx: AuthCtx,
  photo: { uploaderId: string; locationId: string | null },
  level: Level,
): boolean {
  return (
    isAdmin(ctx) ||
    isUploader(ctx, photo) ||
    (photo.locationId !== null && atLeast(level, "precise"))
  );
}

/** Originals are private to the uploader and admins (DESIGN §3.4 rule 6). */
export const canSeePhotoOriginal = (ctx: AuthCtx, photo: { uploaderId: string }): boolean =>
  isAdmin(ctx) || isUploader(ctx, photo);

/** Roles allowed to upload at all (guests are read-only). */
export const canUploadPhoto = (ctx: AuthCtx): boolean => ctx.role !== "guest";

export const canAttachPhotoToLocation = (ctx: AuthCtx, level: Level): boolean =>
  ctx.role !== "guest" && atLeast(level, "contribute");

/** Edit the visit, or at least contribute on its location. */
export function canAttachPhotoToVisit(
  ctx: AuthCtx,
  visit: { authorId: string },
  level: Level,
): boolean {
  if (ctx.role === "guest") return false;
  return canMutateVisit(ctx, visit, level, "edit") || atLeast(level, "contribute");
}

/** Caption/sort/move: uploader, or `edit` on the photo's location. */
export function canEditPhoto(ctx: AuthCtx, photo: { uploaderId: string }, level: Level): boolean {
  if (ctx.role === "guest") return false;
  return isUploader(ctx, photo) || atLeast(level, "edit");
}

/** Delete: uploader, or `manage` on the photo's location. */
export function canDeletePhoto(ctx: AuthCtx, photo: { uploaderId: string }, level: Level): boolean {
  if (ctx.role === "guest") return false;
  return isUploader(ctx, photo) || atLeast(level, "manage");
}

/** A cover photo needs `edit` on the location it belongs to. */
export const canSetCoverPhoto = (ctx: AuthCtx, level: Level): boolean =>
  ctx.role !== "guest" && atLeast(level, "edit");
