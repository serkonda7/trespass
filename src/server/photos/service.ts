// Photos: upload/list/assign/caption/reorder/delete/cover. Independent of the
// request; ./functions.ts adds authMiddleware, ./upload.ts handles multipart.
// Every visibility decision comes from src/server/authz/photos.ts and is
// enforced in SQL. Precise-only fields are added to the DTO on the server.
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { z } from "zod";
import {
  assignPhotoInput,
  listPhotosInput,
  photoIdInput,
  reorderPhotosInput,
  setCoverPhotoInput,
  updatePhotoInput,
} from "../../lib/photos/inputs";
import { photoUrl } from "../../lib/photos/rules";
import type { PhotoList, PhotoSuggestion, SerializedPhoto } from "../../lib/photos/types";
import { PHOTO_SIZES } from "../../lib/photos/types";
import { recordEvent } from "../audit";
import {
  canAttachPhotoToLocation,
  canAttachPhotoToVisit,
  canDeletePhoto,
  canEditPhoto,
  canSeePhotoGps,
  canSeePhotoOriginal,
  canSetCoverPhoto,
  canUploadPhoto,
  loadLocationForCtx,
  locationLevels,
  photoLocationVisibleWhere,
  photosAtLeastWhere,
  photoVisitVisibleWhere,
  visibleLocationsWhere,
  visiblePhotoIdsWhere,
  visiblePhotosWhere,
  visibleVisitsWhere,
} from "../authz";
import type { AuthCtx } from "../authz/ctx";
import type { Level } from "../authz/levels";
import type { AppDb, DbOrTx } from "../db/client";
import { locations, photos, users, visits } from "../db/schema";
import { kickJobWorker } from "../jobs/worker";
import { PhotoError, photoForbidden, photoNotFound } from "./errors";
import { enqueueBlobGc } from "./gc";

const asDb = (db: DbOrTx) => db as unknown as AppDb;

// The location alias is also the source of the caller's level for this photo.
const photoLoc = () => alias(locations, "photo_loc");

type PhotoRow = {
  photo: typeof photos.$inferSelect;
  locationId: string | null;
  ownerId: string | null;
  visibility: string | null;
  friendsLevel: string | null;
  locationVisible: number;
  visitVisible: number;
  uploaderName: string | null;
};

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new PhotoError(422, "PHOTO_BAD_REQUEST");
  return r.data;
}

/** One SQL query, with the visibility predicate ANDed in, never JS filtering. */
function selectRows(db: DbOrTx, ctx: AuthCtx, where: SQL[]): PhotoRow[] {
  const loc = photoLoc();
  return db
    .select({
      photo: photos,
      locationId: loc.id,
      ownerId: loc.ownerId,
      visibility: loc.visibility,
      friendsLevel: loc.friendsLevel,
      locationVisible: photoLocationVisibleWhere(ctx, loc),
      visitVisible: photoVisitVisibleWhere(ctx, photos),
      uploaderName: users.displayName,
    })
    .from(photos)
    .leftJoin(loc, eq(loc.id, photos.locationId))
    .leftJoin(users, eq(users.id, photos.uploaderId))
    .where(and(visiblePhotosWhere(ctx, photos), ...where))
    .orderBy(asc(photos.sort), asc(photos.takenAt), asc(photos.createdAt), asc(photos.id))
    .all();
}

function requireRow(db: DbOrTx, ctx: AuthCtx, id: string): PhotoRow {
  const row = selectRows(db, ctx, [eq(photos.id, id)])[0];
  if (!row) throw photoNotFound();
  return row;
}

function levelOf(db: DbOrTx, ctx: AuthCtx, row: PhotoRow): Level {
  if (
    !row.locationId ||
    !row.locationVisible ||
    !row.ownerId ||
    !row.visibility ||
    !row.friendsLevel
  )
    return "none";
  return (locationLevels(asDb(db), ctx, [
    {
      id: row.locationId,
      ownerId: row.ownerId,
      visibility: row.visibility as "private" | "friends",
      friendsLevel: row.friendsLevel as "view" | "contribute" | "precise",
    },
  ]).get(row.locationId) ?? "none") as Level;
}

function loadSuggestion(db: DbOrTx, ctx: AuthCtx, row: PhotoRow): PhotoSuggestion | null {
  const id = row.photo.suggestedLocationId;
  if (!id) return null;
  const loc = photoLoc();
  const found = db
    .select({ id: loc.id, name: loc.name })
    .from(loc)
    .where(and(eq(loc.id, id), visibleLocationsWhere(ctx, loc)))
    .get();
  if (!found) return null;
  let visitId: string | null = null;
  let visitedOn: string | null = null;
  if (row.photo.suggestedVisitId) {
    const visit = db
      .select({ id: visits.id, visitedOn: visits.visitedOn })
      .from(visits)
      .where(
        and(
          eq(visits.id, row.photo.suggestedVisitId),
          eq(visits.locationId, id),
          visibleVisitsWhere(ctx, visits),
        ),
      )
      .get();
    if (visit) {
      visitId = visit.id;
      visitedOn = visit.visitedOn;
    }
  }
  return { locationId: found.id, locationName: found.name, visitId, visitedOn };
}

function serialize(db: DbOrTx, ctx: AuthCtx, row: PhotoRow): SerializedPhoto {
  const photo = row.photo;
  const level = levelOf(db, ctx, row);
  const canEdit = canEditPhoto(ctx, photo, level);
  const canDelete = canDeletePhoto(ctx, photo, level);
  const canGps = canSeePhotoGps(ctx, photo, level);
  const urls = Object.fromEntries(
    PHOTO_SIZES.map((s) => [s, photoUrl(photo.id, s)]),
  ) as SerializedPhoto["urls"];
  const out: SerializedPhoto = {
    id: photo.id,
    urls,
    caption: photo.caption,
    originalName: photo.originalName,
    takenAt: photo.takenAt,
    width: photo.width,
    height: photo.height,
    status: photo.status,
    locationId: row.locationVisible ? row.locationId : null,
    visitId: row.visitVisible ? photo.visitId : null,
    uploaderId: photo.uploaderId,
    uploaderName: row.uploaderName ?? "",
    exif: photo.exif,
    sort: photo.sort,
    createdAt: photo.createdAt,
    permissions: {
      canEdit,
      canDelete,
      canAssign: canUploadPhoto(ctx) && canEdit,
      canSetCover: canSetCoverPhoto(ctx, level),
    },
  };
  if (canSeePhotoOriginal(ctx, photo)) out.originalUrl = photoUrl(photo.id, "original");
  if (canGps && photo.gpsLat !== null && photo.gpsLon !== null) {
    out.gps = { lat: photo.gpsLat, lon: photo.gpsLon };
    out.suggestion = loadSuggestion(db, ctx, row);
  }
  return out;
}

// --- Read ---------------------------------------------------------------------

export function listPhotos(db: AppDb, ctx: AuthCtx, raw: unknown): PhotoList {
  const input = parse(listPhotosInput, raw);
  const where: SQL[] = [];
  let level: string | undefined;
  if (input.locationId) {
    const found = loadLocationForCtx(db, ctx, input.locationId, "view");
    if (!found) throw photoNotFound();
    where.push(eq(photos.locationId, found.location.id));
    level = found.level;
  }
  if (input.visitId) {
    const visit = db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.id, input.visitId), visibleVisitsWhere(ctx, visits)))
      .get();
    if (!visit) throw photoNotFound();
    where.push(eq(photos.visitId, visit.id));
  }
  if (input.unsorted) where.push(isNull(photos.locationId), isNull(photos.visitId));
  const rows = selectRows(db, ctx, where).slice(0, input.limit ?? 2000);
  return { photos: rows.map((row) => serialize(db, ctx, row)), ...(level ? { level } : {}) };
}

export function getPhoto(db: AppDb, ctx: AuthCtx, raw: unknown): SerializedPhoto {
  const { id } = parse(photoIdInput, raw);
  return serialize(db, ctx, requireRow(db, ctx, id));
}

/**
 * Visible photo ids for journal embeds, checked in one SQL query with the photo
 * predicate. Only ready photos are embedded so the image never answers 202.
 */
export function resolvePhotoEmbeds(
  db: AppDb,
  ctx: AuthCtx,
  ids: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = db
    .select({ id: photos.id })
    .from(photos)
    .where(and(visiblePhotoIdsWhere(ctx, ids), eq(photos.status, "ready")))
    .all();
  for (const row of rows) out.set(row.id, photoUrl(row.id, 1600));
  return out;
}

/** Embeds referenced by a Markdown text (exported for the journal service). */
export function photoEmbedIds(md: string): string[] {
  const re = /!\[[^\]]*\]\(\s*photo:([A-Za-z0-9_-]+)\s*\)/g;
  return [...md.matchAll(re)].map((m) => m[1]!).filter((id, i, all) => all.indexOf(id) === i);
}

// --- Write --------------------------------------------------------------------

export function updatePhoto(db: AppDb, ctx: AuthCtx, raw: unknown): SerializedPhoto {
  const input = parse(updatePhotoInput, raw);
  return db.transaction((tx) => {
    const row = requireRow(tx, ctx, input.id);
    if (!canEditPhoto(ctx, row.photo, levelOf(tx, ctx, row))) throw photoForbidden();
    const set: Partial<typeof photos.$inferInsert> = {};
    if (input.caption !== undefined) set.caption = input.caption;
    if (input.sort !== undefined) set.sort = input.sort;
    if (Object.keys(set).length) {
      tx.update(photos).set(set).where(eq(photos.id, input.id)).run();
      recordEvent(tx, {
        actorId: ctx.userId,
        entityId: input.id,
        action: "photo.updated",
        diff: {
          photoId: input.id,
          ...(input.caption !== undefined ? { caption: input.caption } : {}),
        },
      });
    }
    return serialize(tx, ctx, requireRow(tx, ctx, input.id));
  });
}

export function assignPhoto(db: AppDb, ctx: AuthCtx, raw: unknown): SerializedPhoto {
  const input = parse(assignPhotoInput, raw);
  return db.transaction((tx) => {
    const row = requireRow(tx, ctx, input.id);
    if (!canEditPhoto(ctx, row.photo, levelOf(tx, ctx, row))) throw photoForbidden();
    const set: Partial<typeof photos.$inferInsert> = {
      suggestedLocationId: null,
      suggestedVisitId: null,
    };
    if (input.locationId !== undefined) {
      if (input.locationId) {
        const found = loadLocationForCtx(asDb(tx), ctx, input.locationId, "view");
        if (!found) throw photoNotFound();
        if (!canAttachPhotoToLocation(ctx, found.level)) throw photoForbidden();
        set.locationId = found.location.id;
      } else set.locationId = null;
    }
    if (input.visitId !== undefined) {
      if (input.visitId) {
        const visit = tx
          .select()
          .from(visits)
          .where(and(eq(visits.id, input.visitId), visibleVisitsWhere(ctx, visits)))
          .get();
        if (!visit) throw photoNotFound();
        const level = loadLocationForCtx(asDb(tx), ctx, visit.locationId)?.level ?? "none";
        if (!canAttachPhotoToVisit(ctx, visit, level)) throw photoForbidden();
        set.visitId = visit.id;
        if (input.locationId === undefined) set.locationId = visit.locationId;
      } else set.visitId = null;
    }
    tx.update(photos).set(set).where(eq(photos.id, input.id)).run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: input.id,
      action: "photo.assigned",
      diff: { photoId: input.id, locationId: set.locationId ?? null, visitId: set.visitId ?? null },
    });
    return serialize(tx, ctx, requireRow(tx, ctx, input.id));
  });
}

export function deletePhoto(db: AppDb, ctx: AuthCtx, raw: unknown): { ok: true } {
  const { id } = parse(photoIdInput, raw);
  db.transaction((tx) => {
    const row = requireRow(tx, ctx, id);
    if (!canDeletePhoto(ctx, row.photo, levelOf(tx, ctx, row))) throw photoForbidden();
    tx.delete(photos).where(eq(photos.id, id)).run();
    // No FK on cover_photo_id (it would make the Drizzle table types cyclic);
    // clear it here when the deleted photo was a cover (DESIGN §4).
    tx.update(locations).set({ coverPhotoId: null }).where(eq(locations.coverPhotoId, id)).run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: id,
      action: "photo.deleted",
      diff: { photoId: id },
    });
    enqueueBlobGc(tx, [row.photo.sha256]);
  });
  kickJobWorker();
  return { ok: true };
}

export function setCoverPhoto(db: AppDb, ctx: AuthCtx, raw: unknown): { coverPhotoId: string } {
  const input = parse(setCoverPhotoInput, raw);
  return db.transaction((tx) => {
    const found = loadLocationForCtx(asDb(tx), ctx, input.locationId, "view");
    if (!found) throw photoNotFound();
    if (!canSetCoverPhoto(ctx, found.level)) throw photoForbidden();
    const photo = tx
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.id, input.photoId),
          eq(photos.locationId, input.locationId),
          visiblePhotosWhere(ctx, photos),
        ),
      )
      .get();
    if (!photo) throw photoNotFound();
    tx.update(locations)
      .set({ coverPhotoId: input.photoId, version: found.location.version + 1 })
      .where(eq(locations.id, input.locationId))
      .run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: input.photoId,
      action: "photo.cover",
      diff: { photoId: input.photoId, locationId: input.locationId },
    });
    return { coverPhotoId: input.photoId };
  });
}

export function reorderPhotos(db: AppDb, ctx: AuthCtx, raw: unknown): PhotoList {
  const input = parse(reorderPhotosInput, raw);
  return db.transaction((tx) => {
    let level = "none";
    if (input.locationId) {
      const found = loadLocationForCtx(asDb(tx), ctx, input.locationId, "view");
      if (!found) throw photoNotFound();
      if (!canSetCoverPhoto(ctx, found.level)) throw photoForbidden();
      level = found.level;
    }
    const where: SQL[] = [];
    if (input.locationId) where.push(eq(photos.locationId, input.locationId));
    if (input.visitId) {
      const visit = tx
        .select()
        .from(visits)
        .where(and(eq(visits.id, input.visitId), visibleVisitsWhere(ctx, visits)))
        .get();
      if (!visit) throw photoNotFound();
      where.push(eq(photos.visitId, visit.id));
    }
    if (!input.locationId && !input.visitId) throw new PhotoError(422, "PHOTO_BAD_REQUEST");
    const rows = selectRows(tx, ctx, where);
    const ids = new Set(rows.map((r) => r.photo.id));
    const wanted = new Set(input.order);
    if (wanted.size !== input.order.length || input.order.some((id) => !ids.has(id)))
      throw new PhotoError(422, "PHOTO_ORDER_INVALID");
    for (const r of rows.filter((r) => wanted.has(r.photo.id))) {
      if (!canEditPhoto(ctx, r.photo, levelOf(tx, ctx, r))) throw photoForbidden();
    }
    const queue = [...input.order];
    // The given ids take the slots they occupy together, others keep theirs.
    const next = rows.map((r) => (wanted.has(r.photo.id) ? queue.shift()! : r.photo.id));
    next.forEach((id, i) => {
      tx.update(photos).set({ sort: i }).where(eq(photos.id, id)).run();
    });
    return {
      photos: selectRows(tx, ctx, where).map((r) => serialize(tx, ctx, r)),
      ...(input.locationId ? { level } : {}),
    };
  });
}

/** Whether a location has any photo the caller can see (cover fallback). */
export function hasVisibleLocationPhotos(db: AppDb, ctx: AuthCtx, locationId: string): boolean {
  return !!db
    .select({ id: photos.id })
    .from(photos)
    .where(
      and(
        eq(photos.locationId, locationId),
        photosAtLeastWhere(ctx, "view"),
        visiblePhotosWhere(ctx, photos),
      ),
    )
    .limit(1)
    .get();
}
