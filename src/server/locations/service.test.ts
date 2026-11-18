import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { haversineMeters } from "../../lib/geo/distance";
import type { Point } from "../../lib/geo/types";
import type { AuthCtx } from "../authz/ctx";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { events, jobs, locations, locationTags } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { listCategories, SEED_CATEGORIES } from "./categories";
import { LocationsError } from "./errors";
import {
  createLocation,
  deleteLocation,
  findDuplicates,
  getLocation,
  listLocationGrants,
  listLocations,
  moveLocation,
  removeLocationGrant,
  setLocationGrant,
  setVisibility,
  updateLocation,
} from "./service";

const ADMIN = "admin-user";
const MEMBER = "member-user";
const GUEST = "guest-user";
const OTHER = "other-user";
const GROUP = "friends-group";
const EXACT: Point = { lat: 51.12345, lon: 7.12345 };

const admin = ctxFor(ADMIN, "admin");
const member = ctxFor(MEMBER, "member", [GROUP]);
const guest = ctxFor(GUEST, "guest");

let db: AppDb;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: ADMIN, role: "admin" },
      { id: MEMBER, role: "member" },
      { id: GUEST, role: "guest" },
      { id: OTHER, role: "member" },
    ],
    groups: [GROUP],
    members: [[GROUP, MEMBER]],
  });
});

function createAs(ctx: AuthCtx, overrides: Partial<Parameters<typeof createLocation>[2]> = {}) {
  return createLocation(db, ctx, {
    name: "Lungenheilstätte",
    categoryId: "cat-sanatorium",
    point: EXACT,
    tags: ["heilstätte", "ruine"],
    ...overrides,
  });
}

function errorCode(fn: () => unknown): { code: string; status: number } | unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof LocationsError ? { code: e.code, status: e.status } : e;
  }
}

describe("categories", () => {
  test("the ten German categories are seeded at startup", () => {
    const rows = listCategories(db);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.name)).toEqual(SEED_CATEGORIES.map((c) => c.name));
    expect(rows.map((r) => r.key)).toContain("sanatorium");
  });
});

describe("createLocation", () => {
  test("generates a stable fuzzed point, timezone, tags, job and audit event", () => {
    const { id, version } = createAs(admin);
    expect(version).toBe(1);
    const row = db.select().from(locations).where(eq(locations.id, id)).get()!;
    expect(row.ownerId).toBe(ADMIN);
    expect(row.lat).toBe(EXACT.lat);
    expect(row.lon).toBe(EXACT.lon);
    expect(row.fuzzRadiusM).toBe(1500); // settings.default_fuzz_m
    expect(row.tz).toBe("Europe/Berlin");
    expect(row.visibility).toBe("private");
    expect(row.friendsLevel).toBe("view");
    expect(row.nameSort).toBe("lungenheilstatte");
    expect(haversineMeters(EXACT, { lat: row.pubLat, lon: row.pubLon })).toBeLessThanOrEqual(1500);
    expect(haversineMeters(EXACT, { lat: row.pubLat, lon: row.pubLon })).toBeGreaterThan(100);
    expect(
      db.select().from(locationTags).where(eq(locationTags.locationId, id)).all(),
    ).toHaveLength(2);
    expect(db.select().from(jobs).where(eq(jobs.kind, "geocode.reverse")).all()).toHaveLength(1);
    const logged = db.select().from(events).where(eq(events.entityId, id)).all();
    expect(logged.map((e) => e.action)).toEqual(["location.created"]);
    expect(JSON.stringify(logged[0].diff)).not.toContain(String(EXACT.lat));
    expect(JSON.stringify(logged[0].diff)).not.toContain(String(EXACT.lon));
  });

  test("guests cannot create; an unknown category is rejected", () => {
    expect(errorCode(() => createAs(guest))).toEqual({ code: "LOCATION_FORBIDDEN", status: 403 });
    expect(errorCode(() => createAs(admin, { categoryId: "nope" }))).toEqual({
      code: "CATEGORY_INVALID",
      status: 422,
    });
  });
});

describe("getLocation and 404-not-403", () => {
  test("admin sees exact, a granted member sees the fuzzed point", () => {
    const { id } = createAs(admin);
    const asAdmin = getLocation(db, admin, id);
    expect(asAdmin.location.exact).toBe(true);
    expect(asAdmin.location.point).toEqual(EXACT);
    expect(asAdmin.location.permissions).toEqual({
      canContribute: true,
      canSeeExact: true,
      canEdit: true,
      canManage: true,
    });
    expect(asAdmin.grants).toEqual([]);

    setLocationGrant(db, admin, {
      locationId: id,
      principalKind: "user",
      principalId: MEMBER,
      level: "view",
    });
    const asMember = getLocation(db, member, id);
    expect(asMember.location.exact).toBe(false);
    expect(asMember.location.point).not.toEqual(EXACT);
    expect(asMember.location.permissions.canManage).toBe(false);
    expect(asMember.grants).toBeNull();
  });

  test("invisible is 404, visible-but-below-min is 403", () => {
    const { id } = createAs(admin);
    expect(errorCode(() => getLocation(db, member, id))).toEqual({
      code: "LOCATION_NOT_FOUND",
      status: 404,
    });
    setLocationGrant(db, admin, {
      locationId: id,
      principalKind: "user",
      principalId: MEMBER,
      level: "view",
    });
    expect(errorCode(() => deleteLocation(db, member, id))).toEqual({
      code: "LOCATION_FORBIDDEN",
      status: 403,
    });
    expect(errorCode(() => getLocation(db, member, "does-not-exist"))).toEqual({
      code: "LOCATION_NOT_FOUND",
      status: 404,
    });
  });
});

describe("updateLocation", () => {
  test("optimistic locking and field/tag changes", () => {
    const { id, version } = createAs(admin);
    expect(
      errorCode(() => updateLocation(db, admin, { id, version: version + 1, name: "Neu" })),
    ).toEqual({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    const result = updateLocation(db, admin, {
      id,
      version,
      name: "Neuer Name",
      status: "researched",
      tags: ["neu"],
    });
    expect(result.version).toBe(2);
    const detail = getLocation(db, admin, id);
    expect(detail.location.name).toBe("Neuer Name");
    expect(detail.location.status).toBe("researched");
    expect(detail.tags).toEqual(["neu"]);
    expect(detail.location.point).toEqual(EXACT);
    expect(
      db
        .select()
        .from(events)
        .where(eq(events.entityId, id))
        .all()
        .map((e) => e.action),
    ).toEqual(["location.created", "location.updated", "location.status_changed"]);
  });

  test("an edit grantee can edit but not change visibility", () => {
    const { id } = createAs(admin);
    setLocationGrant(db, admin, {
      locationId: id,
      principalKind: "user",
      principalId: MEMBER,
      level: "edit",
    });
    const { version } = getLocation(db, member, id).location;
    expect(updateLocation(db, member, { id, version, description: "Notiz" }).version).toBe(
      version + 1,
    );
    expect(
      errorCode(() =>
        setVisibility(db, member, {
          id,
          version: version + 1,
          visibility: "friends",
          friendsLevel: "view",
        }),
      ),
    ).toEqual({ code: "LOCATION_FORBIDDEN", status: 403 });
  });
});

describe("moveLocation", () => {
  test("keeps the public point when the new exact point is still within the radius", () => {
    const { id, version } = createAs(admin, { point: EXACT, fuzzRadiusM: 1500 });
    const before = getLocation(db, admin, id).location.point;
    const pubBefore = db.select().from(locations).where(eq(locations.id, id)).get()!;
    // Move a little towards the existing public point: it still covers the
    // new exact point, so the public point must be kept.
    const nearby: Point = {
      lat: EXACT.lat + (pubBefore.pubLat - EXACT.lat) * 0.2,
      lon: EXACT.lon + (pubBefore.pubLon - EXACT.lon) * 0.2,
    };
    expect(haversineMeters(nearby, { lat: pubBefore.pubLat, lon: pubBefore.pubLon })).toBeLessThan(
      1500,
    );
    expect(moveLocation(db, admin, { id, version, point: nearby }).version).toBe(2);
    const after = db.select().from(locations).where(eq(locations.id, id)).get()!;
    expect(after.pubLat).toBe(pubBefore.pubLat);
    expect(after.pubLon).toBe(pubBefore.pubLon);
    expect(after.lat).toBe(nearby.lat);
    expect(after.tz).toBe("Europe/Berlin");
    expect(before).toEqual(EXACT);
    const moveEvents = db
      .select()
      .from(events)
      .where(eq(events.entityId, id))
      .all()
      .filter((e) => e.action === "location.moved");
    expect(moveEvents).toHaveLength(1);
    expect(JSON.stringify(moveEvents[0].diff)).toBe(
      JSON.stringify({ coords: { from: "changed", to: "changed" } }),
    );
  });

  test("regenerates when the point is far away or the radius changes", () => {
    const { id, version } = createAs(admin, { point: EXACT, fuzzRadiusM: 1500 });
    const first = db.select().from(locations).where(eq(locations.id, id)).get()!;
    moveLocation(db, admin, { id, version, point: { lat: 40, lon: -3 } });
    const moved = db.select().from(locations).where(eq(locations.id, id)).get()!;
    expect(moved.pubLat).not.toBe(first.pubLat);
    expect(moved.tz).toBe("Europe/Madrid");
    moveLocation(db, admin, {
      id,
      version: 2,
      point: { lat: 40, lon: -3 },
      fuzzRadiusM: 800,
    });
    const reradius = db.select().from(locations).where(eq(locations.id, id)).get()!;
    expect(reradius.pubLat).not.toBe(moved.pubLat);
    expect(reradius.fuzzRadiusM).toBe(800);
  });

  test("a stale version conflicts", () => {
    const { id, version } = createAs(admin);
    moveLocation(db, admin, { id, version, point: { lat: 50, lon: 7 } });
    expect(errorCode(() => moveLocation(db, admin, { id, version, point: EXACT }))).toEqual({
      code: "VERSION_CONFLICT",
      status: 409,
    });
  });
});

describe("visibility and grants", () => {
  test("friends_level governs members, guests are capped at view", () => {
    const { id } = createAs(admin);
    const v = getLocation(db, admin, id).location.version;
    setVisibility(db, admin, { id, version: v, visibility: "friends", friendsLevel: "precise" });
    expect(getLocation(db, member, id).location.exact).toBe(true);
    expect(getLocation(db, guest, id).location.exact).toBe(false);
    expect(getLocation(db, guest, id).location.level).toBe("view");
  });

  test("grants to guests cannot exceed the role ceiling; principals must exist", () => {
    const { id } = createAs(admin);
    expect(
      errorCode(() =>
        setLocationGrant(db, admin, {
          locationId: id,
          principalKind: "user",
          principalId: GUEST,
          level: "manage",
        }),
      ),
    ).toEqual({ code: "GRANT_ABOVE_CEILING", status: 403 });
    expect(
      errorCode(() =>
        setLocationGrant(db, admin, {
          locationId: id,
          principalKind: "user",
          principalId: "missing",
          level: "view",
        }),
      ),
    ).toEqual({ code: "GRANT_INVALID", status: 422 });
    setLocationGrant(db, admin, {
      locationId: id,
      principalKind: "group",
      principalId: GROUP,
      level: "precise",
    });
    expect(getLocation(db, member, id).location.exact).toBe(true);
    expect(listLocationGrants(db, admin, id).map((g) => g.level)).toEqual(["precise"]);
    expect(
      removeLocationGrant(db, admin, {
        locationId: id,
        principalKind: "group",
        principalId: GROUP,
      }),
    ).toEqual([]);
  });
});

describe("listLocations and findDuplicates", () => {
  test("bbox and near use the visible point for viewers below precise", () => {
    const { id } = createAs(admin, { visibility: "friends", friendsLevel: "view" });
    const pub = db.select().from(locations).where(eq(locations.id, id)).get()!;
    const publicPoint: Point = { lat: pub.pubLat, lon: pub.pubLon };
    const listAsGuest = (bbox?: Parameters<typeof listLocations>[2]["bbox"]) =>
      listLocations(db, guest, bbox ? { bbox } : {});

    expect(listAsGuest().rows.map((r) => r.id)).toEqual([id]);
    expect(listAsGuest().rows[0].point).toEqual(publicPoint);
    expect(listAsGuest().rows[0].exact).toBe(false);
    const aroundPub = {
      minLat: publicPoint.lat - 0.01,
      minLon: publicPoint.lon - 0.01,
      maxLat: publicPoint.lat + 0.01,
      maxLon: publicPoint.lon + 0.01,
    };
    expect(listAsGuest(aroundPub).rows.map((r) => r.id)).toEqual([id]);
    const aroundExact = {
      minLat: EXACT.lat - 0.00001,
      minLon: EXACT.lon - 0.00001,
      maxLat: EXACT.lat + 0.00001,
      maxLon: EXACT.lon + 0.00001,
    };
    expect(listAsGuest(aroundExact).rows).toEqual([]);
    const near = listLocations(db, guest, {
      near: { lat: EXACT.lat + 0.00001, lon: EXACT.lon + 0.00001 },
    });
    expect(near.rows[0].point).toEqual(publicPoint);
  });

  test("filters, paging and cursor", () => {
    createAs(admin, { name: "Bunker A", status: "idea" });
    createAs(admin, { name: "Bunker B", status: "planned" });
    createAs(admin, { name: "Villa C", status: "planned" });
    const first = listLocations(db, admin, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = listLocations(db, admin, { limit: 2, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(listLocations(db, admin, { status: ["planned"] }).rows.map((r) => r.name)).toEqual([
      "Bunker B",
      "Villa C",
    ]);
    expect(listLocations(db, admin, { q: "bunker" }).rows.map((r) => r.name)).toEqual([
      "Bunker A",
      "Bunker B",
    ]);
    expect(errorCode(() => listLocations(db, admin, { cursor: "!!!" }))).toEqual({
      code: "CURSOR_INVALID",
      status: 422,
    });
  });

  test("duplicates come only from visible locations and use the visible point", () => {
    createAs(admin, { name: "Altbau" });
    createAs(admin, { name: "Völlig anders", point: { lat: 40, lon: -3 } });
    const dups = findDuplicates(db, admin, { point: EXACT, name: "Altbau" });
    expect(dups.map((d) => d.id)).toHaveLength(1);
    expect(dups[0].reason).toBe("nearby");
    expect(dups[0].point).toEqual(EXACT);
    // Invisible to the guest: no duplicates at all.
    expect(findDuplicates(db, guest, { point: EXACT, name: "Altbau" })).toEqual([]);
  });
});

describe("deleteLocation", () => {
  test("owner can delete, cascading grants and tags; event survives", () => {
    const { id } = createAs(admin);
    setLocationGrant(db, admin, {
      locationId: id,
      principalKind: "user",
      principalId: MEMBER,
      level: "view",
    });
    deleteLocation(db, admin, id);
    expect(db.select().from(locations).where(eq(locations.id, id)).get()).toBeUndefined();
    expect(db.select().from(locationTags).where(eq(locationTags.locationId, id)).all()).toEqual([]);
    expect(
      db
        .select()
        .from(events)
        .where(eq(events.entityId, id))
        .all()
        .map((e) => e.action),
    ).toContain("location.deleted");
  });
});
