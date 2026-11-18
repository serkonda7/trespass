// Shared output shapes for photos. No server-only imports here. Below `precise`
// the exact GPS point, the suggestion and the original URL are ABSENT keys, not
// null (DESIGN §3.4 rule 4, §3.5 rule 6).

/** Stored EXIF is reduced to this allow-list — never GPS, serials or software. */
export type PhotoExifData = {
  make?: string;
  model?: string;
  lens?: string;
  focalLength?: number;
  exposure?: number;
  iso?: number;
};

export type PhotoSize = 400 | 1600 | 2560;
export const PHOTO_SIZES: readonly PhotoSize[] = [400, 1600, 2560];

export type PhotoStatus = "processing" | "ready" | "failed";

export type PhotoSuggestion = {
  locationId: string;
  locationName: string;
  visitId: string | null;
  visitedOn: string | null;
};

/** What the client may do with the photo (server-computed). */
export type PhotoPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canSetCover: boolean;
};

export type SerializedPhoto = {
  id: string;
  /** Derivative URLs, always present once the photo is ready. */
  urls: { 400: string; 1600: string; 2560: string };
  /** Only present for the uploader and admins (rule 6). */
  originalUrl?: string;
  caption: string | null;
  originalName: string | null;
  takenAt: Date | null;
  width: number;
  height: number;
  status: PhotoStatus;
  /** Null when the referenced location/visit is not visible to the caller. */
  locationId: string | null;
  visitId: string | null;
  uploaderId: string;
  uploaderName: string;
  exif: PhotoExifData;
  sort: number;
  createdAt: Date;
  permissions: PhotoPermissions;
  /** Precise viewers, the uploader and admins only. Absent otherwise. */
  gps?: { lat: number; lon: number };
  /** Same audience as GPS: it is derived from GPS. Absent otherwise. */
  suggestion?: PhotoSuggestion | null;
};

export type PhotoList = {
  photos: SerializedPhoto[];
  /** The caller's level on the filtered location, when one was given. */
  level?: string;
};
