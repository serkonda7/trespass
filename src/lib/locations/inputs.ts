// Zod inputs for the location server functions. Shared with the client so
// forms can reuse them; the service parses again with parseInput().
import { z } from "zod";

export const LOCATION_NAME_MAX = 200;
export const TEXT_MAX = 5000;
export const TAG_NAME_MAX = 40;
export const MAX_TAGS = 30;
export const PAGE_MAX = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const DUPLICATE_RADIUS_M = 200;

export const idSchema = z.string().min(1).max(64);
const version = z.number().int().min(1);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const year = z.number().int().min(1).max(9999).nullable().optional();

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export type PointInput = z.input<typeof pointSchema>;

/** Stored statuses only: `visited` is derived and can never be written. */
export const statusSchema = z.enum([
  "idea",
  "researched",
  "planned",
  "sealed",
  "redeveloped",
  "demolished",
]);
/** Statuses usable as a filter/list value, including derived `visited`. */
export const effectiveStatusSchema = z.enum([...statusSchema.options, "visited"] as const);
export const visibilitySchema = z.enum(["private", "friends"]);
export const friendsLevelSchema = z.enum(["view", "contribute", "precise"]);
export const grantLevelSchema = z.enum(["view", "contribute", "precise", "edit", "manage"]);
export const principalKindSchema = z.enum(["user", "group"]);

const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()]))),
});

export const createLocationInput = z.object({
  name: z.string().trim().min(1).max(LOCATION_NAME_MAX),
  description: optText(TEXT_MAX),
  categoryId: idSchema,
  status: statusSchema.optional(),
  point: pointSchema,
  /** Defaults to settings.default_fuzz_m. */
  fuzzRadiusM: z.number().int().min(0).max(100_000).optional(),
  parking: z.array(pointSchema).min(1).max(20).nullable().optional(),
  geomArea: polygonSchema.nullable().optional(),
  accessNotes: optText(TEXT_MAX),
  dangerNotes: optText(TEXT_MAX),
  builtYear: year,
  abandonedYear: year,
  tags: z.array(z.string().trim().min(1).max(TAG_NAME_MAX)).max(MAX_TAGS).optional(),
  visibility: visibilitySchema.optional(),
  friendsLevel: friendsLevelSchema.optional(),
});
export type CreateLocationInput = z.input<typeof createLocationInput>;

export const updateLocationInput = z.object({
  id: idSchema,
  version,
  name: z.string().trim().min(1).max(LOCATION_NAME_MAX).optional(),
  description: optText(TEXT_MAX),
  categoryId: idSchema.optional(),
  status: statusSchema.optional(),
  accessNotes: optText(TEXT_MAX),
  dangerNotes: optText(TEXT_MAX),
  builtYear: year,
  abandonedYear: year,
  tags: z.array(z.string().trim().min(1).max(TAG_NAME_MAX)).max(MAX_TAGS).optional(),
});
export type UpdateLocationInput = z.input<typeof updateLocationInput>;

export const moveLocationInput = z.object({
  id: idSchema,
  version,
  point: pointSchema,
  /** Changing the radius always regenerates the public point. */
  fuzzRadiusM: z.number().int().min(0).max(100_000).optional(),
});
export type MoveLocationInput = z.input<typeof moveLocationInput>;

export const setVisibilityInput = z.object({
  id: idSchema,
  version,
  visibility: visibilitySchema,
  friendsLevel: friendsLevelSchema,
});
export type SetVisibilityInput = z.input<typeof setVisibilityInput>;

export const grantInput = z.object({
  locationId: idSchema,
  principalKind: principalKindSchema,
  principalId: idSchema,
  level: grantLevelSchema,
});
export type GrantInput = z.input<typeof grantInput>;

export const removeGrantInput = z.object({
  locationId: idSchema,
  principalKind: principalKindSchema,
  principalId: idSchema,
});
export type RemoveGrantInput = z.input<typeof removeGrantInput>;

export const bboxSchema = z.object({
  minLat: z.number().finite().min(-90).max(90),
  minLon: z.number().finite().min(-180).max(180),
  maxLat: z.number().finite().min(-90).max(90),
  maxLon: z.number().finite().min(-180).max(180),
});

export const listLocationsInput = z.object({
  status: z.array(effectiveStatusSchema).max(7).optional(),
  categoryId: z.array(idSchema).max(50).optional(),
  tag: z.array(z.string().trim().min(1).max(TAG_NAME_MAX)).max(50).optional(),
  country: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  bbox: bboxSchema.optional(),
  near: pointSchema.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(PAGE_MAX).optional(),
  cursor: z.string().max(500).optional(),
});
export type ListLocationsInput = z.input<typeof listLocationsInput>;

export const findDuplicatesInput = z.object({
  point: pointSchema,
  name: z.string().trim().min(1).max(LOCATION_NAME_MAX),
});
export type FindDuplicatesInput = z.input<typeof findDuplicatesInput>;

export const locationIdInput = z.object({ id: idSchema });
export const locationRefInput = z.object({ id: idSchema, version });
