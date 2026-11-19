// EXIF is read from the original BEFORE any sharp processing; derivatives are
// auto-rotated WebP with ALL metadata stripped (no withMetadata/keepExif). The
// original stays on disk for the uploader/admin only, so a friend can never get
// GPS out of a derivative (DESIGN §3.4 rules 4 & 6, §5.3, §13).

import { localDateTimeToUtc } from "@trespass/shared/format";
import { type SniffedMime, sniffMime } from "@trespass/shared/mime-sniff";
import type { PhotoExifData, PhotoSize } from "@trespass/shared/photos/types";
import { PHOTO_SIZES } from "@trespass/shared/photos/types";
import exifr from "exifr";
import sharp, { type Metadata, type SharpOptions } from "sharp";
import { PhotoError } from "./errors";
import type { PhotoStore } from "./storage";

/** True when the production sharp build can decode HEIC/HEIF files. */
export function heicSupported(): boolean {
  return Boolean(sharp.format.heif?.input?.file);
}

/** Types accepted by the upload route (HEIC only when sharp supports it). */
export function acceptedMimes(): readonly SniffedMime[] {
  const base: SniffedMime[] = ["image/jpeg", "image/png", "image/webp", "image/avif"];
  return heicSupported() ? [...base, "image/heic"] : base;
}

/** Magic-byte sniffing only; the file name and client Content-Type are ignored. */
export function sniffPhotoMime(bytes: Uint8Array): SniffedMime | null {
  const mime = sniffMime(bytes);
  if (!mime || !(acceptedMimes() as readonly string[]).includes(mime)) return null;
  return mime;
}

// libvips works in its own thread pool; decoding a large camera photo needs a
// few hundred MB, so at most two images are processed at once.
const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const SHARP_INPUT: SharpOptions = {
  limitInputPixels: 80_000_000,
  failOn: "error",
  sequentialRead: true,
  pages: 1,
};

/** What sharp's parser must report for each sniffed type (polyglot guard). */
const SHARP_FORMAT: Partial<Record<SniffedMime, string>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "heif",
  "image/heic": "heif",
};

async function readMetadata(bytes: Uint8Array): Promise<Metadata> {
  try {
    const meta = await sharp(bytes, SHARP_INPUT).metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    return meta;
  } catch {
    throw new PhotoError(422, "PHOTO_IMAGE_INVALID");
  }
}

/** Validates that the bytes really are the type the magic bytes claimed. */
export async function verifyImage(bytes: Uint8Array, mime: SniffedMime): Promise<Metadata> {
  const meta = await readMetadata(bytes);
  if (meta.format !== SHARP_FORMAT[mime]) throw new PhotoError(422, "PHOTO_IMAGE_INVALID");
  if (mime === "image/heic") {
    // sharp's prebuilt libvips often ships libheif without an HEVC decoder.
    // Probe instead of assuming, so a build that can decode just works.
    try {
      await sharp(bytes, SHARP_INPUT).resize(8, 8).raw().toBuffer();
    } catch {
      throw new PhotoError(422, "PHOTO_IMAGE_INVALID");
    }
  }
  return meta;
}

export type ExtractedExif = {
  /** UTC timestamp when the offset or a time zone was known; UTC guess otherwise. */
  takenAt: Date | null;
  /** Naive local wall time ("YYYY:MM:DD HH:MM:SS") when no UTC offset was set. */
  takenLocal: string | null;
  offset: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  exif: PhotoExifData;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

function normalizeLocal(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  // exifr normally returns a Date; some cameras give "2026:11:18 12:34:56".
  const match = /^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!match) return null;
  const [, y, mo, d, h, mi, sec] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}`;
}

/**
 * Reads EXIF before anything is stripped. Only camera/lens/exposure values are
 * kept for the DTO; GPS goes into separate exact columns and is never stored in
 * `exif`. Serial numbers, software and other tags are discarded.
 */
export async function extractExif(bytes: Uint8Array): Promise<ExtractedExif> {
  let raw: Record<string, unknown>;
  try {
    raw =
      (await exifr.parse(Buffer.from(bytes), {
        tiff: true,
        exif: true,
        gps: true,
        translateValues: true,
      })) ?? {};
  } catch {
    raw = {};
  }

  const exif: PhotoExifData = {
    ...(str(raw.Make) ? { make: str(raw.Make) } : {}),
    ...(str(raw.Model) ? { model: str(raw.Model) } : {}),
    ...(str(first(raw.LensModel) ?? raw.Lens)
      ? { lens: str(first(raw.LensModel) ?? raw.Lens) }
      : {}),
    ...(num(first(raw.FocalLength)) !== undefined
      ? { focalLength: num(first(raw.FocalLength)) }
      : {}),
    ...(num(first(raw.ExposureTime)) !== undefined
      ? { exposure: num(first(raw.ExposureTime)) }
      : {}),
    ...(num(first(raw.ISO) ?? first(raw.ISOSpeedRatings)) !== undefined
      ? { iso: num(first(raw.ISO) ?? first(raw.ISOSpeedRatings)) }
      : {}),
  };

  const offset = str(raw.OffsetTimeOriginal) ?? null;
  const takenLocal = normalizeLocal(raw.DateTimeOriginal);
  let takenAt: Date | null = null;
  if (raw.DateTimeOriginal instanceof Date && !Number.isNaN(raw.DateTimeOriginal.getTime())) {
    takenAt = raw.DateTimeOriginal;
  } else if (takenLocal) {
    if (offset) {
      const d = new Date(`${takenLocal}:00${offset}`);
      takenAt = Number.isNaN(d.getTime()) ? null : d;
    } else {
      takenAt = localDateTimeToUtc(takenLocal, "UTC");
    }
  }

  const lat = num(first(raw.GPSLatitude) ?? raw.latitude);
  const lon = num(first(raw.GPSLongitude) ?? raw.longitude);
  const latRef = str(raw.GPSLatitudeRef);
  const lonRef = str(raw.GPSLongitudeRef);
  const gpsLat = lat === undefined ? null : latRef === "S" ? -Math.abs(lat) : lat;
  const gpsLon = lon === undefined ? null : lonRef === "W" ? -Math.abs(lon) : lon;

  return { takenAt, takenLocal, offset, gpsLat, gpsLon, exif };
}

/** Resolves a naive camera clock in the location's time zone (DESIGN §5.7). */
export function resolveTakenAt(extracted: ExtractedExif, tz?: string | null): Date | null {
  if (!extracted.takenLocal) return extracted.takenAt;
  if (extracted.offset) {
    const d = new Date(`${extracted.takenLocal}:00${extracted.offset}`);
    return Number.isNaN(d.getTime()) ? extracted.takenAt : d;
  }
  return localDateTimeToUtc(extracted.takenLocal, tz ?? "UTC");
}

/**
 * Creates all three derivatives from the ORIGINAL bytes. `.rotate()` applies
 * EXIF orientation; no metadata is copied, so GPS/XMP/IPTC/ICC never survive.
 */
export async function makeDerivatives(
  bytes: Uint8Array,
  store: PhotoStore,
  sha256: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  const meta = await readMetadata(bytes);
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new PhotoError(422, "PHOTO_IMAGE_INVALID");
  const oriented =
    meta.orientation && meta.orientation >= 5 ? { w: height, h: width } : { w: width, h: height };

  await Promise.all(
    PHOTO_SIZES.map(async (size: PhotoSize) => {
      if (signal?.aborted) throw new Error("aborted");
      const out = await withSlot(() =>
        sharp(bytes, SHARP_INPUT)
          .rotate()
          .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer(),
      );
      await store.putDerived(
        sha256,
        size,
        new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
      );
    }),
  );
  return { width: oriented.w, height: oriented.h };
}
