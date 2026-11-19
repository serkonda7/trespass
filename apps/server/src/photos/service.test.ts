import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { jobs, locations, photos, visits } from "../db/schema";
import { createTestDb } from "../db/test-db";
import {
  assignPhoto,
  deletePhoto,
  getPhoto,
  listPhotos,
  reorderPhotos,
  setCoverPhoto,
  updatePhoto,
} from "./service";
import { insertPhoto } from "./test-helpers";

const ADMIN = "admin";
const OWNER = "owner";
const VIEWER = "viewer";
const PRECISE = "precise";
const AUTHOR = "author";
const VISIBLE = "loc-visible";
const INVISIBLE = "loc-invisible";

function setup() {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: ADMIN, role: "admin" },
      { id: OWNER, role: "member" },
      { id: VIEWER, role: "member" },
      { id: PRECISE, role: "member" },
      { id: AUTHOR, role: "member" },
    ],
    locations: [
      {
        id: VISIBLE,
        ownerId: OWNER,
        lat: 51,
        lon: 7,
        pubLat: 51.001,
        pubLon: 7.001,
        tz: "Etc/UTC",
        visibility: "friends",
        friendsLevel: "view",
      },
      {
        id: INVISIBLE,
        ownerId: OWNER,
        lat: 52,
        lon: 8,
        pubLat: 52.001,
        pubLon: 8.001,
        tz: "Etc/UTC",
        visibility: "private",
      },
    ],
    grants: [
      { locationId: VISIBLE, principalKind: "user", principalId: PRECISE, level: "precise" },
    ],
  });
  db.insert(visits)
    .values({
      id: "visit-hidden",
      locationId: INVISIBLE,
      authorId: AUTHOR,
      visitedOn: "2026-11-18",
      journalMd: "",
    })
    .run();
  const shared = insertPhoto(db, {
    id: "p-shared",
    uploaderId: OWNER,
    locationId: VISIBLE,
    gpsLat: 51,
    gpsLon: 7,
    sha256: "a".repeat(64),
  });
  const unsorted = insertPhoto(db, {
    id: "p-unsorted",
    uploaderId: OWNER,
    gpsLat: 51,
    gpsLon: 7,
    sha256: "b".repeat(64),
  });
  const onVisit = insertPhoto(db, {
    id: "p-visit",
    uploaderId: AUTHOR,
    visitId: "visit-hidden",
    gpsLat: 52,
    gpsLon: 8,
    sha256: "c".repeat(64),
  });
  return { db, shared, unsorted, onVisit };
}

function expectNotFound(fn: () => unknown) {
  try {
    fn();
    throw new Error("expected PHOTO_NOT_FOUND");
  } catch (err) {
    expect((err as Error).message).toContain("PHOTO_NOT_FOUND");
    expect((err as { status?: number }).status).toBe(404);
  }
}

describe("photo visibility matrix", () => {
  test("uploader and admin see GPS/original, a view-level friend does not", () => {
    const { db, shared } = setup();
    for (const ctx of [ctxFor(OWNER, "member"), ctxFor(ADMIN, "admin")]) {
      const dto = getPhoto(db, ctx, { id: shared.id });
      expect(dto.gps).toEqual({ lat: 51, lon: 7 });
      expect(dto.originalUrl).toContain("size=original");
      expect(dto.locationId).toBe(VISIBLE);
      expect(dto.urls[400]).toContain("size=400");
    }
    const view = getPhoto(db, ctxFor(VIEWER, "member"), { id: shared.id });
    expect(view.gps).toBeUndefined();
    expect(view.originalUrl).toBeUndefined();
    expect("gps" in view).toBe(false);
    expect(view.locationId).toBe(VISIBLE);
    expect(view.permissions.canEdit).toBe(false);
    expect(view.permissions.canDelete).toBe(false);

    const precise = getPhoto(db, ctxFor(PRECISE, "member"), { id: shared.id });
    expect(precise.gps).toEqual({ lat: 51, lon: 7 });
    expect(precise.originalUrl).toBeUndefined();
    const guest = getPhoto(db, ctxFor("guest", "guest"), { id: shared.id }).locationId;
    expect(guest).toBe(VISIBLE);
  });

  test("unsorted photos are only visible to uploader/admin", () => {
    const { db, unsorted } = setup();
    expect(getPhoto(db, ctxFor(OWNER, "member"), { id: unsorted.id }).id).toBe(unsorted.id);
    expect(getPhoto(db, ctxFor(ADMIN, "admin"), { id: unsorted.id }).id).toBe(unsorted.id);
    expectNotFound(() => getPhoto(db, ctxFor(VIEWER, "member"), { id: unsorted.id }));
    expect(listPhotos(db, ctxFor(VIEWER, "member"), { unsorted: true }).photos).toEqual([]);
    expect(listPhotos(db, ctxFor(OWNER, "member"), { unsorted: true }).photos).toHaveLength(1);
  });

  test("an author keeps a photo on a now-invisible location, with locationId null", () => {
    const { db, onVisit } = setup();
    const dto = getPhoto(db, ctxFor(AUTHOR, "member"), { id: onVisit.id });
    expect(dto.visitId).toBe("visit-hidden");
    expect(dto.locationId).toBeNull();
    expect(dto.gps).toEqual({ lat: 52, lon: 8 }); // uploader
    expectNotFound(() => getPhoto(db, ctxFor(VIEWER, "member"), { id: onVisit.id }));
  });

  test("invisible locations and missing photos answer 404", () => {
    const { db } = setup();
    expectNotFound(() => getPhoto(db, ctxFor(VIEWER, "member"), { id: "nope" }));
    expectNotFound(() => listPhotos(db, ctxFor(VIEWER, "member"), { locationId: INVISIBLE }));
    expectNotFound(() => listPhotos(db, ctxFor(VIEWER, "member"), { visitId: "visit-hidden" }));
  });

  test("listPhotos filters in SQL and orders by sort/takenAt", () => {
    const { db } = setup();
    insertPhoto(db, {
      id: "z",
      uploaderId: OWNER,
      locationId: VISIBLE,
      sort: 5,
      sha256: "d".repeat(64),
    });
    const list = listPhotos(db, ctxFor(VIEWER, "member"), { locationId: VISIBLE });
    expect(list.photos.map((p) => p.id)).toEqual(["p-shared", "z"]);
    expect(list.level).toBe("view");
  });
});

describe("photo changes", () => {
  test("caption and reorder need edit rights; the uploader always has them", () => {
    const { db, shared } = setup();
    expect(() =>
      updatePhoto(db, ctxFor(VIEWER, "member"), { id: shared.id, caption: "x" }),
    ).toThrow(/PHOTO_FORBIDDEN/);
    const updated = updatePhoto(db, ctxFor(OWNER, "member"), { id: shared.id, caption: "Dach" });
    expect(updated.caption).toBe("Dach");
    insertPhoto(db, {
      id: "second",
      uploaderId: OWNER,
      locationId: VISIBLE,
      sort: 1,
      sha256: "e".repeat(64),
    });
    const reordered = reorderPhotos(db, ctxFor(OWNER, "member"), {
      locationId: VISIBLE,
      order: ["second", shared.id],
    });
    expect(reordered.photos.map((p) => p.id)).toEqual(["second", "p-shared"]);
    expect(() =>
      reorderPhotos(db, ctxFor(OWNER, "member"), {
        locationId: VISIBLE,
        order: [shared.id, "nope"],
      }),
    ).toThrow(/PHOTO_ORDER_INVALID/);
  });

  test("assigning a suggestion attaches the photo and clears the suggestion", () => {
    const { db, unsorted } = setup();
    db.update(photos)
      .set({ suggestedLocationId: VISIBLE, suggestedVisitId: "visit-hidden" })
      .where(eq(photos.id, unsorted.id))
      .run();
    const dto = assignPhoto(db, ctxFor(OWNER, "member"), {
      id: unsorted.id,
      locationId: VISIBLE,
      visitId: "visit-hidden",
    });
    expect(dto.locationId).toBe(VISIBLE);
    expect(dto.visitId).toBe("visit-hidden");
    const row = db.select().from(photos).where(eq(photos.id, unsorted.id)).get()!;
    expect(row.suggestedLocationId).toBeNull();
    expect(row.suggestedVisitId).toBeNull();
  });

  test("cover photo needs edit on the location and must belong to it", () => {
    const { db, shared, unsorted } = setup();
    expect(() =>
      setCoverPhoto(db, ctxFor(VIEWER, "member"), { locationId: VISIBLE, photoId: shared.id }),
    ).toThrow(/PHOTO_FORBIDDEN/);
    expectNotFound(() =>
      setCoverPhoto(db, ctxFor(OWNER, "member"), { locationId: VISIBLE, photoId: unsorted.id }),
    );
    const result = setCoverPhoto(db, ctxFor(OWNER, "member"), {
      locationId: VISIBLE,
      photoId: shared.id,
    });
    expect(result.coverPhotoId).toBe(shared.id);
    expect(db.select().from(locations).where(eq(locations.id, VISIBLE)).get()!.coverPhotoId).toBe(
      shared.id,
    );
  });

  test("delete needs uploader/manage, clears the cover and queues blob GC", () => {
    const { db, shared, unsorted } = setup();
    expect(() => deletePhoto(db, ctxFor(VIEWER, "member"), { id: shared.id })).toThrow(
      /PHOTO_FORBIDDEN/,
    );
    db.update(locations).set({ coverPhotoId: shared.id }).where(eq(locations.id, VISIBLE)).run();
    expect(deletePhoto(db, ctxFor(OWNER, "member"), { id: shared.id })).toEqual({ ok: true });
    expect(db.select().from(photos).where(eq(photos.id, shared.id)).get()).toBeUndefined();
    expect(
      db.select().from(locations).where(eq(locations.id, VISIBLE)).get()!.coverPhotoId,
    ).toBeNull();
    const gc = db.select().from(jobs).all();
    expect(gc.some((j) => j.kind === "photos.gc")).toBe(true);
    expect(deletePhoto(db, ctxFor(OWNER, "member"), { id: unsorted.id })).toEqual({ ok: true });
  });
});
