// Photo rules shared by the server (enforcement) and the UI (early checks).
// The server decides the type by magic bytes (../mime-sniff.ts).
import type { PhotoSize } from "./types";

/** Caddy allows 110 MB request bodies (DESIGN §5.3); one file per request. */
export const MAX_BODY_BYTES = 105_000_000;
export const MAX_FILE_BYTES = 100_000_000;

/** Decoded image size limit (decompression bombs): 80 MP. */
export const MAX_INPUT_PIXELS = 80_000_000;

export const PHOTO_ERRORS = [
  "PHOTO_NOT_FOUND",
  "PHOTO_FORBIDDEN",
  "PHOTO_TYPE_UNSUPPORTED",
  "PHOTO_TOO_LARGE",
  "PHOTO_EMPTY",
  "PHOTO_IMAGE_INVALID",
  "PHOTO_BAD_REQUEST",
  "PHOTO_ORDER_INVALID",
  "PHOTO_ASSIGN_INVALID",
  "NOT_AUTHENTICATED",
] as const;
export type PhotoErrorCode = (typeof PHOTO_ERRORS)[number];

/** Client-side hint only; the server sniffs the actual bytes. */
export const ACCEPT_ATTR_BASE = "image/jpeg,image/png,image/webp,image/avif";
export const ACCEPT_ATTR_HEIC = `${ACCEPT_ATTR_BASE},image/heic,image/heif,.heic,.heif`;

export const uploadPhotoUrl = () => "/api/v1/photos";

/** URL of a photo derivative; served by src/routes/files.$photoId.ts. */
export const photoUrl = (photoId: string, size: PhotoSize | "original" = 1600) =>
  `/files/${encodeURIComponent(photoId)}?size=${size}`;

/** Strips paths, control characters and odd whitespace from a client file name. */
export function cleanFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2000-\u200a\u2028-\u2029\u202a-\u202e]/g;
  const cleaned = base.replace(CONTROL, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned.slice(0, 200);
}
