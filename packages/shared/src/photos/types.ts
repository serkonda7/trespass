// Shared output shapes for photos. No server-only imports here. GPS and the
// suggestion are absent only when the photo has no usable GPS. The original URL
// stays private to the uploader and admins (DESIGN §3.5 rule 6).

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
  /** Absent when the photo has no GPS data. */
  gps?: { lat: number; lon: number };
  /** Derived from GPS; absent when there is no GPS. */
  suggestion?: PhotoSuggestion | null;
};

export type PhotoList = {
  photos: SerializedPhoto[];
  /** The caller's level on the filtered location, when one was given. */
  level?: string;
};
