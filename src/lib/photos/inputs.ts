// Zod inputs for the photo server functions and the upload route.
import { z } from "zod";

const id = z.string().min(1).max(64);

export const photoIdInput = z.object({ id });

export const listPhotosInput = z.object({
  locationId: id.optional(),
  visitId: id.optional(),
  /** The uploader's own unsorted photos (plus admins). */
  unsorted: z.literal(true).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});
export type ListPhotosInput = z.infer<typeof listPhotosInput>;

export const updatePhotoInput = z.object({
  id,
  caption: z.string().max(2000).nullable().optional(),
  sort: z.number().int().min(0).optional(),
});
export type UpdatePhotoInput = z.infer<typeof updatePhotoInput>;

export const assignPhotoInput = z.object({
  id,
  locationId: id.nullable().optional(),
  visitId: id.nullable().optional(),
});
export type AssignPhotoInput = z.infer<typeof assignPhotoInput>;

export const reorderPhotosInput = z.object({
  locationId: id.optional(),
  visitId: id.optional(),
  order: z.array(id).min(1).max(2000),
});
export type ReorderPhotosInput = z.infer<typeof reorderPhotosInput>;

export const setCoverPhotoInput = z.object({ locationId: id, photoId: id });
export type SetCoverPhotoInput = z.infer<typeof setCoverPhotoInput>;

/** Optional multipart fields of POST /api/v1/photos. */
export const uploadFieldsInput = z.object({
  locationId: id.optional(),
  visitId: id.optional(),
  caption: z.string().max(2000).optional(),
});
