import { beforeEach, describe, expect, test } from "bun:test";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { photos } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createLocation } from "../locations/service";
import { createTrip } from "../trips/service";
import { createVisit } from "../visits/service";
import { getDashboard } from "./service";

const admin = ctxFor("admin", "admin");
const owner = ctxFor("owner", "member");
const friend = ctxFor("friend", "member");
const stranger = ctxFor("stranger", "member");
let db: AppDb;
let shared: string;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: "admin", role: "admin" },
      { id: "owner", role: "member" },
      { id: "friend", role: "member" },
      { id: "stranger", role: "member" },
    ],
  });
  shared = createLocation(db, owner, {
    name: "Geteilt",
    categoryId: "cat-industry",
    point: { lat: 51.1, lon: 7.1 },
    visibility: "friends",
    friendsLevel: "contribute",
    status: "planned",
  }).id;
  createLocation(db, owner, {
    name: "Geheim",
    categoryId: "cat-industry",
    point: { lat: 51.2, lon: 7.3 },
  });
});

describe("getDashboard", () => {
  test("counts only visible locations, by effective status", () => {
    createVisit(db, owner, { locationId: shared });
    const own = getDashboard(db, owner);
    expect(own.locations).toBe(2);
    expect(own.statusCounts).toMatchObject({ visited: 1, idea: 1, planned: 0 });

    // "Geheim" is private: other members see only the shared place.
    const seen = getDashboard(db, friend);
    expect(seen.locations).toBe(1);
    expect(seen.statusCounts).toMatchObject({ visited: 1, idea: 0 });
    expect(seen.recentVisits.map((v) => v.location?.id)).toEqual([shared]);
    expect(seen.year.visits).toBe(1);
  });

  test("unsorted photos count only the caller's own", () => {
    db.insert(photos)
      .values({ sha256: "a".repeat(64), uploaderId: "owner", mime: "image/jpeg", bytes: 1 })
      .run();
    expect(getDashboard(db, owner).unsortedPhotos).toBe(1);
    expect(getDashboard(db, admin).unsortedPhotos).toBe(0);
  });

  test("open trips follow trip visibility; the research inbox is admin-only", () => {
    createTrip(db, owner, { title: "Tour", people: [{ userId: "friend" }] });
    expect(getDashboard(db, friend).openTrips.map((t) => t.title)).toEqual(["Tour"]);
    expect(getDashboard(db, stranger).openTrips).toHaveLength(0);
    expect("researchInbox" in getDashboard(db, owner)).toBe(false);
    expect(getDashboard(db, admin).researchInbox).toBe(0);
  });
});
