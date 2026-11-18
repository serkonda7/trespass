import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { photos } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { makeDerivatives } from "./process";
import { parseRange, servePhoto } from "./serve";
import { insertPhoto, jpegFixture, tempPhotoStore } from "./test-helpers";

const OWNER = "owner";
const MEMBER = "member";
const LOC = "loc";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function setup(locationId: string | null = LOC) {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: OWNER, role: "member" },
      { id: MEMBER, role: "member" },
      { id: "admin", role: "admin" },
    ],
    locations: [
      {
        id: LOC,
        ownerId: OWNER,
        lat: 51,
        lon: 7,
        pubLat: 51,
        pubLon: 7,
        tz: "Etc/UTC",
        visibility: "friends",
        friendsLevel: "view",
      },
    ],
  });
  const t = tempPhotoStore();
  cleanup = t.cleanup;
  const bytes = await jpegFixture({ gps: null, xmp: false });
  const { sha256 } = await t.store.put(bytes);
  await makeDerivatives(bytes, t.store, sha256);
  const photo = insertPhoto(db, {
    uploaderId: OWNER,
    locationId,
    sha256,
    bytes: bytes.byteLength,
    originalName: "Dach.jpg",
  });
  return {
    db,
    store: t.store,
    photo,
    req: (size: string, headers: Record<string, string> = {}) =>
      new Request(`http://localhost/files/${photo.id}?size=${size}`, { headers }),
  };
}

describe("GET /files/:photoId", () => {
  test("friends get derivatives with strict CSP and private immutable caching", async () => {
    const { db, store, photo, req } = await setup();
    const res = await servePhoto(db, ctxFor(MEMBER, "member"), store, req("400"), photo.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBe(`"${photo.sha256}-400"`);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("originals are 404 for friends, 200 for the uploader and admins", async () => {
    const { db, store, photo, req } = await setup();
    const friend = await servePhoto(db, ctxFor(MEMBER, "member"), store, req("original"), photo.id);
    expect(friend.status).toBe(404);
    expect((await friend.json()).error).toBe("PHOTO_NOT_FOUND");
    for (const ctx of [ctxFor(OWNER, "member"), ctxFor("admin", "admin")]) {
      const res = await servePhoto(db, ctx, store, req("original"), photo.id);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("etag")).toBe(`"${photo.sha256}-original"`);
    }
  });

  test("unsorted photos are only served to the uploader/admin", async () => {
    const { db, store, photo, req } = await setup(null);
    const friend = await servePhoto(db, ctxFor(MEMBER, "member"), store, req("1600"), photo.id);
    expect(friend.status).toBe(404);
    const owner = await servePhoto(db, ctxFor(OWNER, "member"), store, req("1600"), photo.id);
    expect(owner.status).toBe(200);
  });

  test("ETag revalidation, byte ranges and HEAD work", async () => {
    const { db, store, photo, req } = await setup();
    const etag = `"${photo.sha256}-1600"`;
    const cached = await servePhoto(
      db,
      ctxFor(MEMBER, "member"),
      store,
      req("1600", { "If-None-Match": etag }),
      photo.id,
    );
    expect(cached.status).toBe(304);

    const ranged = await servePhoto(
      db,
      ctxFor(MEMBER, "member"),
      store,
      req("1600", { Range: "bytes=0-9" }),
      photo.id,
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-length")).toBe("10");
    expect((await ranged.arrayBuffer()).byteLength).toBe(10);

    const head = await servePhoto(
      db,
      ctxFor(MEMBER, "member"),
      store,
      new Request(`http://localhost/files/${photo.id}?size=1600`, { method: "HEAD" }),
      photo.id,
    );
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(parseRange("bytes=0-1", 5)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=9-10", 5)).toBe("invalid");
  });

  test("processing derivatives answer 202 with Retry-After", async () => {
    const { db, store, photo, req } = await setup();
    db.update(photos).set({ status: "processing" }).where(eq(photos.id, photo.id)).run();
    const res = await servePhoto(db, ctxFor(MEMBER, "member"), store, req("400"), photo.id);
    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBe("1");
  });
});
