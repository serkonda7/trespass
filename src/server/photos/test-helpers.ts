// Test-only fixtures for the photo pipeline. The JPEG carries EXIF (camera,
// lens, GPS, taken date), XMP and orientation so the metadata-stripping test
// has something real to check. No app module imports this file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { AppDb } from "../db/client";
import { photos } from "../db/schema";
import { createPhotoStore, type PhotoStore } from "./storage";

export async function jpegFixture(
  opts: { gps?: { lat: number; lon: number } | null; orientation?: 1 | 6; xmp?: boolean } = {},
): Promise<Uint8Array> {
  const gps = opts.gps === undefined ? { lat: 51.12345, lon: 7.12345 } : opts.gps;
  let pipeline = sharp({
    create: { width: 120, height: 80, channels: 3, background: "#336699" },
  })
    .withExif({
      IFD0: { Make: "TestCam", Model: "X1" },
      IFD2: {
        DateTimeOriginal: "2026:11:18 12:34:56",
        LensModel: "50mm f/1.8",
        FocalLength: "50",
        ExposureTime: "0.01",
        ISOSpeedRatings: "200",
      },
      ...(gps
        ? {
            IFD3: {
              GPSLatitude: String(gps.lat),
              GPSLatitudeRef: gps.lat < 0 ? "S" : "N",
              GPSLongitude: String(gps.lon),
              GPSLongitudeRef: gps.lon < 0 ? "W" : "E",
            },
          }
        : {}),
    })
    .withMetadata({ orientation: opts.orientation ?? 1 });
  if (opts.xmp !== false) {
    pipeline = pipeline.withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>geheim</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>',
    );
  }
  const out = await pipeline.jpeg().toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export async function pngFixture(): Promise<Uint8Array> {
  const out = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#cc6633" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export function tempPhotoStore(): { store: PhotoStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "trespass-photos-"));
  return {
    store: createPhotoStore(dir),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function insertPhoto(
  db: AppDb,
  fields: Partial<typeof photos.$inferInsert> & {
    uploaderId: string;
    sha256?: string;
  },
) {
  return db
    .insert(photos)
    .values({
      sha256: fields.sha256 ?? "b".repeat(64),
      mime: "image/jpeg",
      bytes: 1234,
      status: "ready",
      ...fields,
    })
    .returning()
    .get();
}
