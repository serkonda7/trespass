import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { locations, photos, visits } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { suggestPhotoMatches } from "./match";
import { insertPhoto } from "./test-helpers";

const EXACT = { lat: 51.12345, lon: 7.12345 };
// ~730 m north of the exact point: a contribute viewer only sees this point.
const FUZZED = { lat: 51.13, lon: 7.12345 };
const TAKEN = new Date("2026-11-18T12:34:56.000Z");

function setup(level: "contribute" | "precise", withVisit: boolean) {
  const db = createTestDb();
  const user = `uploader-${level}-${withVisit}`;
  const loc = `loc-${level}-${withVisit}`;
  seed(db, {
    users: [
      { id: user, role: "member" },
      { id: "someone-else", role: "member" },
    ],
    locations: [
      {
        id: loc,
        ownerId: "someone-else",
        lat: EXACT.lat,
        lon: EXACT.lon,
        pubLat: FUZZED.lat,
        pubLon: FUZZED.lon,
        tz: "Etc/UTC",
        visibility: "private",
      },
    ],
    grants: [{ locationId: loc, principalKind: "user", principalId: user, level }],
  });
  if (withVisit) {
    db.insert(visits)
      .values({
        id: `visit-${loc}`,
        locationId: loc,
        authorId: user,
        visitedOn: "2026-11-18",
        journalMd: "",
      })
      .run();
  }
  return { db, user, loc, ctx: ctxFor(user, "member") };
}

describe("photo auto-matching uses visible coordinates", () => {
  test("a contribute viewer gets no suggestion when GPS equals the exact point", () => {
    const { db, user } = setup("contribute", false);
    const photo = insertPhoto(db, {
      uploaderId: user,
      gpsLat: EXACT.lat,
      gpsLon: EXACT.lon,
      takenAt: TAKEN,
    });
    const match = suggestPhotoMatches(db, photo.id, EXACT, TAKEN);
    expect(match).toBeNull();
    expect(
      db.select().from(photos).where(eq(photos.id, photo.id)).get()!.suggestedLocationId,
    ).toBeNull();
  });

  test("a precise viewer with the same GPS gets the location suggestion", () => {
    const { db, user, loc } = setup("precise", false);
    const photo = insertPhoto(db, {
      uploaderId: user,
      gpsLat: EXACT.lat,
      gpsLon: EXACT.lon,
      takenAt: TAKEN,
    });
    const match = suggestPhotoMatches(db, photo.id, EXACT, TAKEN);
    expect(match?.locationId).toBe(loc);
    expect(db.select().from(photos).where(eq(photos.id, photo.id)).get()!.suggestedLocationId).toBe(
      loc,
    );
  });

  test("a visit on the photo's local day is suggested too", () => {
    const { db, user, loc } = setup("precise", true);
    const photo = insertPhoto(db, {
      uploaderId: user,
      gpsLat: EXACT.lat,
      gpsLon: EXACT.lon,
      takenAt: TAKEN,
    });
    const match = suggestPhotoMatches(db, photo.id, EXACT, TAKEN);
    expect(match?.visitId).toBe(`visit-${loc}`);
    expect(match?.visitedOn).toBe("2026-11-18");
  });

  test("photos without GPS stay unsorted and stale suggestions are cleared", () => {
    const { db, user, loc } = setup("precise", false);
    const photo = insertPhoto(db, {
      uploaderId: user,
      suggestedLocationId: loc,
      takenAt: TAKEN,
    });
    expect(suggestPhotoMatches(db, photo.id, null, TAKEN)).toBeNull();
    const row = db.select().from(photos).where(eq(photos.id, photo.id)).get()!;
    expect(row.suggestedLocationId).toBeNull();
    expect(row.locationId).toBeNull();
    expect(row.visitId).toBeNull();
  });

  test("a naive camera clock is interpreted in the matched location's zone", () => {
    const { db, user, loc } = setup("precise", false);
    db.update(locations).set({ tz: "Asia/Tokyo" }).where(eq(locations.id, loc)).run();
    const photo = insertPhoto(db, {
      uploaderId: user,
      gpsLat: EXACT.lat,
      gpsLon: EXACT.lon,
    });
    suggestPhotoMatches(db, photo.id, EXACT, TAKEN, "2026-11-19T01:00:00", null);
    const row = db.select().from(photos).where(eq(photos.id, photo.id)).get()!;
    expect(row.takenAt?.toISOString()).toBe("2026-11-18T16:00:00.000Z");
  });
});
