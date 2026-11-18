import { afterEach, describe, expect, test } from "bun:test";
import exifr from "exifr";
import sharp from "sharp";
import { PHOTO_SIZES } from "../../lib/photos/types";
import { extractExif, heicSupported, makeDerivatives, sniffPhotoMime } from "./process";
import type { PhotoStore } from "./storage";
import { jpegFixture, pngFixture, tempPhotoStore } from "./test-helpers";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function storeWith(bytes: Uint8Array): Promise<{ store: PhotoStore; sha: string }> {
  const t = tempPhotoStore();
  cleanup = t.cleanup;
  const { sha256 } = await t.store.put(bytes);
  return { store: t.store, sha: sha256 };
}

describe("photo process", () => {
  test("heicSupported reports sharp's runtime capability", async () => {
    const sharpMod = (await import("sharp")).default;
    expect(heicSupported()).toBe(Boolean(sharpMod.format.heif?.input?.file));
    expect(typeof heicSupported()).toBe("boolean");
  });

  test("sniffs by magic bytes, not file name or client type", async () => {
    expect(sniffPhotoMime(await jpegFixture())).toBe("image/jpeg");
    expect(sniffPhotoMime(await pngFixture())).toBe("image/png");
    expect(sniffPhotoMime(new TextEncoder().encode("just text"))).toBeNull();
  });

  test("reads EXIF before stripping and never stores GPS in the EXIF JSON", async () => {
    const ex = await extractExif(await jpegFixture());
    expect(ex.takenAt?.toISOString()).toContain("2026-11-18");
    expect(ex.gpsLat).toBeGreaterThan(51);
    expect(ex.gpsLon).toBeGreaterThan(7);
    expect(ex.exif.make).toBe("TestCam");
    expect(ex.exif.model).toBe("X1");
    expect(ex.exif.lens).toBe("50mm f/1.8");
    expect(ex.exif.focalLength).toBe(50);
    expect(ex.exif.exposure).toBeCloseTo(0.01);
    // Only camera/lens/exposure keys; no GPS, serial, software or XMP text.
    expect(Object.keys(ex.exif).sort()).toEqual([
      "exposure",
      "focalLength",
      "iso",
      "lens",
      "make",
      "model",
    ]);
    expect(JSON.stringify(ex.exif)).not.toContain("51.");
    expect(JSON.stringify(ex.exif)).not.toContain("geheim");
  });

  test("derivatives are stripped, auto-rotated and available in all sizes", async () => {
    const bytes = await jpegFixture({ orientation: 6 });
    const { store, sha } = await storeWith(bytes);
    const size = await makeDerivatives(bytes, store, sha);
    expect(size).toEqual({ width: 80, height: 120 }); // orientation applied
    for (const edge of PHOTO_SIZES) {
      expect(store.hasDerived(sha, edge)).toBe(true);
      const out = await Bun.file(store.derivedPath(sha, edge)).bytes();
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBeLessThanOrEqual(edge);
      expect(meta.height).toBeLessThanOrEqual(edge);
      // DESIGN §13: no metadata left.
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      const parsed = await exifr
        .parse(out, { gps: true, xmp: true, iptc: true, icc: false })
        .catch(() => null);
      expect(parsed ?? undefined).toBeUndefined();
      const raw = Buffer.from(out).toString("latin1");
      expect(raw).not.toContain("TestCam");
      expect(raw).not.toContain("geheim");
    }
  });

  test("without enlargement small photos stay at their original size", async () => {
    const bytes = await jpegFixture({ gps: null, xmp: false });
    const { store, sha } = await storeWith(bytes);
    await makeDerivatives(bytes, store, sha);
    const meta = await sharp(await Bun.file(store.derivedPath(sha, 1600)).bytes()).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(80);
  });
});
