// POST /api/v1/photos (multipart/form-data: `file`, optional `locationId`,
// `visitId`, `caption`). One file per request so the UI can show progress and
// retry per file. Permission is checked before the body is read; the file is
// then streamed to a temp file while hashing, moved atomically into the blob
// store and inserted as a `processing` row with a `photos.process` job.
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, rmSync, writeSync } from "node:fs";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { uploadFieldsInput } from "@trespass/shared/photos/inputs";
import { cleanFileName, MAX_BODY_BYTES, MAX_FILE_BYTES } from "@trespass/shared/photos/rules";
import { and, eq, sql } from "drizzle-orm";
import { recordEvent } from "../audit";
import { HttpError } from "../auth/context";
import {
  canAttachPhotoToLocation,
  canAttachPhotoToVisit,
  canUploadPhoto,
  loadLocationForCtx,
  visibleVisitsWhere,
} from "../authz";
import type { AppDb, DbOrTx } from "../db/client";
import { photos, visits } from "../db/schema";
import { enqueueJob } from "../jobs/queue";
import { kickJobWorker } from "../jobs/worker";
import { PhotoError, photoErrorResponse, photoForbidden, photoNotFound, tooLarge } from "./errors";
import { PROCESS_JOB } from "./kinds";
import { sniffPhotoMime, verifyImage } from "./process";
import type { PhotoStore } from "./storage";

const badRequest = () => new PhotoError(400, "PHOTO_BAD_REQUEST");
const invalid = () => new PhotoError(422, "PHOTO_IMAGE_INVALID");

type AttachFields = { locationId?: string; visitId?: string; caption?: string };

/** 404 for invisible/missing targets, 403 for visible-but-denied ones. */
function checkAttach(db: AppDb, ctx: AuthCtx, f: AttachFields) {
  if (!f.locationId && !f.visitId) return;
  if (f.locationId) {
    const found = loadLocationForCtx(db, ctx, f.locationId, "view");
    if (!found) throw photoNotFound();
    if (!canAttachPhotoToLocation(ctx, found.level)) throw photoForbidden();
  }
  if (f.visitId) {
    const visit = db
      .select()
      .from(visits)
      .where(and(eq(visits.id, f.visitId), visibleVisitsWhere(ctx, visits)))
      .get();
    if (!visit || (f.locationId && visit.locationId !== f.locationId)) throw photoNotFound();
    const level = loadLocationForCtx(db, ctx, visit.locationId)?.level ?? "none";
    if (!canAttachPhotoToVisit(ctx, visit, level)) throw photoForbidden();
  }
}

function nextSort(db: DbOrTx, locationId?: string, visitId?: string): number {
  const r = db
    .select({ next: sql<number>`coalesce(max(${photos.sort}), -1) + 1` })
    .from(photos)
    .where(
      locationId
        ? eq(photos.locationId, locationId)
        : visitId
          ? eq(photos.visitId, visitId)
          : undefined,
    )
    .get();
  return r?.next ?? 0;
}

export async function handleUploadRequest(
  db: AppDb,
  ctx: AuthCtx,
  store: PhotoStore,
  request: Request,
): Promise<Response> {
  try {
    if (!canUploadPhoto(ctx)) throw photoForbidden();
    const type = request.headers.get("Content-Type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) throw badRequest();
    const declared = Number(request.headers.get("Content-Length") ?? "NaN");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest();
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) throw badRequest();
    if (file.size === 0) throw new PhotoError(400, "PHOTO_EMPTY");
    if (file.size > MAX_FILE_BYTES) throw tooLarge();

    const magic = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    const mime = sniffPhotoMime(magic);
    if (!mime) throw new PhotoError(415, "PHOTO_TYPE_UNSUPPORTED");

    const rawFields = Object.fromEntries(
      [...form.entries()].filter(([key, value]) => key !== "file" && typeof value === "string"),
    );
    const parsed = uploadFieldsInput.safeParse(rawFields);
    if (!parsed.success) throw badRequest();
    checkAttach(db, ctx, parsed.data);

    // Stream the blob to disk while hashing; the body is never kept as one
    // contiguous JS buffer after this point.
    const { path: tmp, fd } = store.createTmp();
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const reader = file.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_FILE_BYTES) throw tooLarge();
        hash.update(value);
        writeSync(fd, value);
      }
      fsyncSync(fd);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    } finally {
      closeSync(fd);
    }
    const sha256 = hash.digest("hex");
    store.commitBlobSync(tmp, sha256);

    // The level may have changed while the file streamed; check again before
    // the synchronous blob+row insert (the same tick, as gc.ts requires).
    checkAttach(db, ctx, parsed.data);
    const stored = await Bun.file(store.blobPath(sha256)).bytes();
    await verifyImage(stored, mime);
    const originalName = cleanFileName(file instanceof File ? file.name : null);
    const row = db.transaction((tx) => {
      const inserted = tx
        .insert(photos)
        .values({
          sha256,
          uploaderId: ctx.userId,
          locationId: parsed.data.locationId ?? null,
          visitId: parsed.data.visitId ?? null,
          caption: parsed.data.caption ?? null,
          originalName,
          mime,
          bytes,
          status: "processing",
          sort: nextSort(tx, parsed.data.locationId, parsed.data.visitId),
        })
        .returning({ id: photos.id })
        .get();
      recordEvent(tx, {
        actorId: ctx.userId,
        entityId: inserted.id,
        action: "photo.added",
        diff: { photoId: inserted.id, locationId: parsed.data.locationId ?? null },
      });
      enqueueJob(tx, PROCESS_JOB, { photoId: inserted.id });
      return inserted;
    });
    kickJobWorker();
    return Response.json({ id: row.id }, { status: 201 });
  } catch (err) {
    if (err instanceof PhotoError || err instanceof HttpError) return photoErrorResponse(err);
    if (err instanceof Error && /format mismatch|no dimensions/i.test(err.message))
      return photoErrorResponse(invalid());
    throw err;
  }
}
