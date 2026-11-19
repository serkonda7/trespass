import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { photos } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { jpegFixture, pngFixture, tempPhotoStore } from "./test-helpers";
import { handleUploadRequest } from "./upload";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function setup() {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: "member", role: "member" },
      { id: "guest", role: "guest" },
    ],
  });
  const t = tempPhotoStore();
  cleanup = t.cleanup;
  return { db, store: t.store, ctx: ctxFor("member", "member") };
}

function multipart(bytes: Uint8Array, name: string, fields: Record<string, string> = {}) {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const form = new FormData();
  form.set("file", new File([copy], name, { type: "application/octet-stream" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/v1/photos", { method: "POST", body: form });
}

describe("POST /api/v1/photos", () => {
  test("stores a photo, dedupes its blob and enqueues processing", async () => {
    const { db, store, ctx } = setup();
    const bytes = await jpegFixture();
    const first = await handleUploadRequest(
      db,
      ctx,
      store,
      multipart(bytes, "photo.JPG", { caption: "Dach" }),
    );
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const row = db.select().from(photos).where(eq(photos.id, id)).get()!;
    expect(row.status).toBe("processing");
    expect(row.caption).toBe("Dach");
    expect(row.originalName).toBe("photo.JPG");
    expect(row.uploaderId).toBe("member");
    expect(store.hasBlob(row.sha256)).toBe(true);
    expect(db.select().from(photos).all()).toHaveLength(1);

    // Same content in a second request: one blob, two independent rows.
    const second = await handleUploadRequest(db, ctx, store, multipart(bytes, "copy.jpg"));
    expect(second.status).toBe(201);
    expect(db.select().from(photos).all()).toHaveLength(2);
    expect(db.selectDistinct({ sha: photos.sha256 }).from(photos).all()).toHaveLength(1);
  });

  test("sniffs content, not the file name: a PNG named .jpg is fine, text is rejected", async () => {
    const { db, store, ctx } = setup();
    const png = await handleUploadRequest(
      db,
      ctx,
      store,
      multipart(await pngFixture(), "fake.jpg"),
    );
    expect(png.status).toBe(201);
    const row = db.select().from(photos).all()[0]!;
    expect(row.mime).toBe("image/png");

    const text = await handleUploadRequest(
      db,
      ctx,
      store,
      multipart(new TextEncoder().encode("hello, not an image"), "evil.jpg"),
    );
    expect(text.status).toBe(415);
    expect((await text.json()).error).toBe("PHOTO_TYPE_UNSUPPORTED");
    expect(db.select().from(photos).all()).toHaveLength(1);
  });

  test("rejects oversized declared bodies and guests before reading the body", async () => {
    const { db, store, ctx } = setup();
    const big = new Request("http://localhost/api/v1/photos", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": "200000000" },
      body: "x",
    });
    const res = await handleUploadRequest(db, ctx, store, big);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("PHOTO_TOO_LARGE");

    const guest = await handleUploadRequest(
      db,
      ctxFor("guest", "guest"),
      store,
      multipart(await jpegFixture(), "x.jpg"),
    );
    expect(guest.status).toBe(403);
  });

  test("rejects attaching to a location the caller cannot contribute to", async () => {
    const { db, store, ctx } = setup();
    const bytes = await jpegFixture();
    const res = await handleUploadRequest(
      db,
      ctx,
      store,
      multipart(bytes, "x.jpg", { locationId: "hidden" }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("PHOTO_NOT_FOUND");
    expect(db.select().from(photos).all()).toHaveLength(0);
  });
});
