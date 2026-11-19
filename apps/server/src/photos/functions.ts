// Server functions for photos. Logic and permission checks live in ./service.ts;
// these add authMiddleware and Zod validation. Uploads are the multipart route
// POST /api/v1/photos (./upload.ts), files are served by /files/$photoId.
import { createServerFn } from "@tanstack/solid-start";
import {
  assignPhotoInput,
  listPhotosInput,
  photoIdInput,
  reorderPhotosInput,
  setCoverPhotoInput,
  updatePhotoInput,
} from "@trespass/shared/photos/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { heicSupported } from "./process";
import {
  assignPhoto,
  deletePhoto,
  getPhoto,
  listPhotos,
  reorderPhotos,
  setCoverPhoto,
  updatePhoto,
} from "./service";

export const listPhotosFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listPhotosInput)
  .handler(({ context: { ctx }, data }) => listPhotos(getDb(), ctx, data));

export const getPhotoFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(photoIdInput)
  .handler(({ context: { ctx }, data }) => getPhoto(getDb(), ctx, data));

export const updatePhotoFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updatePhotoInput)
  .handler(({ context: { ctx }, data }) => updatePhoto(getDb(), ctx, data));

export const assignPhotoFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(assignPhotoInput)
  .handler(({ context: { ctx }, data }) => assignPhoto(getDb(), ctx, data));

export const deletePhotoFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(photoIdInput)
  .handler(({ context: { ctx }, data }) => deletePhoto(getDb(), ctx, data));

export const setCoverPhotoFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(setCoverPhotoInput)
  .handler(({ context: { ctx }, data }) => setCoverPhoto(getDb(), ctx, data));

export const reorderPhotosFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(reorderPhotosInput)
  .handler(({ context: { ctx }, data }) => reorderPhotos(getDb(), ctx, data));

/** The uploader's `accept` attribute depends on the production sharp build. */
export const heicSupportedFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => ({ supported: heicSupported() }));
