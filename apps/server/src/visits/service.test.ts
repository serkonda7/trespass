import { beforeEach, describe, expect, test } from "bun:test";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { addDays, todayInTz } from "@trespass/shared/format";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { events, locations, visitPeople, visits } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { LocationsError } from "../locations/errors";
import {
  createLocation,
  getLocation,
  listLocations,
  setLocationGrant,
  setVisibility,
  updateLocation,
} from "../locations/service";
import { VisitsError } from "./errors";
import {
  createVisit,
  deleteVisit,
  getLocationTimeline,
  getVisit,
  listFeed,
  listVisitsForLocation,
  updateVisit,
  yearReview,
} from "./service";

const ADMIN = "admin-user";
const OWNER = "owner-user";
const MEMBER = "member-user";
const OTHER = "other-user";
const GUEST = "guest-user";
const EXACT = { lat: 51.12345, lon: 7.12345 };

const admin = ctxFor(ADMIN, "admin");
const owner = ctxFor(OWNER, "member");
const member = ctxFor(MEMBER, "member");
const other = ctxFor(OTHER, "member");
const guest = ctxFor(GUEST, "guest");

let db: AppDb;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: ADMIN, role: "admin" },
      { id: OWNER, role: "member" },
      { id: MEMBER, role: "member" },
      { id: OTHER, role: "member" },
      { id: GUEST, role: "guest" },
    ],
  });
});

function makeLocation(ctx: AuthCtx = owner, overrides: Record<string, unknown> = {}) {
  return createLocation(db, ctx, {
    name: "Alte Fabrik",
    categoryId: "cat-industry",
    point: EXACT,
    ...overrides,
  });
}

function grant(
  userId: string,
  level: "view" | "contribute" | "precise" | "edit" | "manage",
  locationId: string,
) {
  setLocationGrant(db, admin, {
    locationId,
    principalKind: "user",
    principalId: userId,
    level,
  });
}

function errorCode(fn: () => unknown): { code: string; status: number } | unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof VisitsError || e instanceof LocationsError
      ? { code: e.code, status: e.status }
      : e;
  }
}

describe("visit permissions", () => {
  test("only admins/members with contribute (or the owner) may create", () => {
    const { id } = makeLocation();
    expect(errorCode(() => createVisit(db, member, { locationId: id }))).toEqual({
      code: "LOCATION_NOT_FOUND",
      status: 404,
    });
    grant(MEMBER, "view", id);
    expect(errorCode(() => createVisit(db, member, { locationId: id }))).toEqual({
      code: "LOCATION_FORBIDDEN",
      status: 403,
    });
    grant(MEMBER, "contribute", id);
    const created = createVisit(db, member, { locationId: id });
    expect(created.version).toBe(1);
    // A guest cannot even see the private location: 404, never 403.
    expect(errorCode(() => createVisit(db, guest, { locationId: id }))).toEqual({
      code: "LOCATION_NOT_FOUND",
      status: 404,
    });
    // The owner is always at manage.
    expect(createVisit(db, owner, { locationId: id }).version).toBe(1);
  });

  test("friends/visible locations let members contribute, guests never", () => {
    const { id } = makeLocation(admin, { visibility: "friends", friendsLevel: "contribute" });
    expect(createVisit(db, member, { locationId: id }).version).toBe(1);
    expect(errorCode(() => createVisit(db, guest, { locationId: id }))).toEqual({
      code: "LOCATION_FORBIDDEN",
      status: 403,
    });
  });

  test("edit/delete: author always, others need edit/manage", () => {
    const { id } = makeLocation();
    grant(MEMBER, "contribute", id);
    grant(OTHER, "edit", id);
    const visitId = createVisit(db, member, { locationId: id }).id;

    // Author may edit and delete their own visit even at contribute.
    expect(updateVisit(db, member, { id: visitId, version: 1, journalMd: "neu" }).version).toBe(2);
    expect(getVisit(db, member, visitId).permissions).toEqual({ canEdit: true, canDelete: true });

    // Another member at edit may edit but not delete.
    expect(updateVisit(db, other, { id: visitId, version: 2, journalMd: "fremd" }).version).toBe(3);
    expect(getVisit(db, other, visitId).permissions).toEqual({ canEdit: true, canDelete: false });
    expect(errorCode(() => deleteVisit(db, other, visitId))).toEqual({
      code: "VISIT_FORBIDDEN",
      status: 403,
    });

    // At manage they may delete it.
    grant(OTHER, "manage", id);
    expect(getVisit(db, other, visitId).permissions.canDelete).toBe(true);
    deleteVisit(db, other, visitId);
    expect(errorCode(() => getVisit(db, other, visitId))).toEqual({
      code: "VISIT_NOT_FOUND",
      status: 404,
    });
  });

  test("invisible location: 404 for others, 403 when visible below the action", () => {
    const { id } = makeLocation();
    grant(MEMBER, "view", id);
    const visitId = createVisit(db, admin, { locationId: id }).id;
    expect(errorCode(() => getVisit(db, other, visitId))).toEqual({
      code: "VISIT_NOT_FOUND",
      status: 404,
    });
    expect(errorCode(() => updateVisit(db, member, { id: visitId, version: 1 }))).toEqual({
      code: "VISIT_FORBIDDEN",
      status: 403,
    });
  });

  test("an author keeps their visit but never the location after access is revoked", () => {
    const { id } = makeLocation();
    grant(MEMBER, "contribute", id);
    const visitId = createVisit(db, member, {
      locationId: id,
      journalMd: "**mein** Text",
      people: [{ name: "Kumpel" }],
    }).id;

    setVisibility(db, admin, { id, version: 2, visibility: "private", friendsLevel: "view" });
    // Simulate a revoked grant directly (the UI only removes grants individually).
    db.$client.query("delete from location_grants where principal_id = ?").run(MEMBER);

    const own = getVisit(db, member, visitId);
    expect(own.location).toBeNull();
    expect(own.journalMd).toBe("**mein** Text");
    expect(own.permissions).toEqual({ canEdit: true, canDelete: true });
    expect(own.people).toEqual([{ userId: null, name: "Kumpel", displayName: "Kumpel" }]);
    expect(errorCode(() => listVisitsForLocation(db, member, id))).toEqual({
      code: "LOCATION_NOT_FOUND",
      status: 404,
    });
    const feed = listFeed(db, member, { limit: 10 });
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]?.location).toBeNull();
    expect(feed.rows[0]?.journalMd).toBe("**mein** Text");
    const review = yearReview(db, member, { year: Number(todayInTz("Etc/UTC").slice(0, 4)) });
    expect(review.visits).toBe(1);
    expect(review.countries).toBe(0);
    expect(listFeed(db, other, { limit: 10 }).rows).toHaveLength(0);
  });

  test("guests never mutate even with a manage grant", () => {
    const { id } = makeLocation(admin, { visibility: "friends", friendsLevel: "view" });
    db.insert(visits)
      .values({
        locationId: id,
        authorId: GUEST,
        visitedOn: todayInTz("Etc/UTC"),
      })
      .run();
    const row = db.select().from(visits).get()!;
    expect(errorCode(() => updateVisit(db, guest, { id: row.id, version: 1 }))).toEqual({
      code: "VISIT_FORBIDDEN",
      status: 403,
    });
  });
});

describe("visit inputs and locking", () => {
  test("date format and future dates are rejected; today in the location tz is allowed", () => {
    const { id } = makeLocation();
    expect(
      errorCode(() => createVisit(db, admin, { locationId: id, visitedOn: "01.03.2026" })),
    ).toEqual(expect.objectContaining({ code: "INVALID_INPUT", status: 422 }));
    expect(
      errorCode(() => createVisit(db, admin, { locationId: id, visitedOn: "2026-02-30" })),
    ).toEqual(expect.objectContaining({ code: "INVALID_INPUT", status: 422 }));
    expect(
      errorCode(() =>
        createVisit(db, admin, { locationId: id, visitedOn: addDays(todayInTz("Etc/UTC"), 3) }),
      ),
    ).toEqual({ code: "VISIT_DATE_INVALID", status: 422 });
    expect(
      createVisit(db, admin, { locationId: id, visitedOn: todayInTz("Etc/UTC") }).version,
    ).toBe(1);
  });

  test("optimistic locking and journal/people updates", () => {
    const { id } = makeLocation();
    const visitId = createVisit(db, admin, {
      locationId: id,
      journalMd: "alt",
      people: [{ userId: MEMBER }],
    }).id;
    expect(
      errorCode(() => updateVisit(db, admin, { id: visitId, version: 2, journalMd: "x" })),
    ).toEqual({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(
      updateVisit(db, admin, {
        id: visitId,
        version: 1,
        journalMd: "neu **fett**",
        people: [{ name: "Ohne Konto" }],
        conditions: { access: "difficult", hazards: ["Hunde"] },
      }).version,
    ).toBe(2);
    const visit = getVisit(db, admin, visitId);
    expect(visit.journalMd).toBe("neu **fett**");
    expect(visit.journalHtml).toContain("<strong>fett</strong>");
    expect(visit.conditions).toEqual({ access: "difficult", hazards: ["Hunde"] });
    expect(visit.people.map((p) => p.displayName)).toEqual(["Ohne Konto"]);
    expect(
      db.select().from(visitPeople).where(eq(visitPeople.visitId, visitId)).all(),
    ).toHaveLength(1);
    const logged = db.select().from(events).where(eq(events.entityId, visitId)).all();
    expect(logged.map((e) => e.action)).toEqual(["visit.created", "visit.updated"]);
    expect(JSON.stringify(logged)).not.toContain("neu **fett**");
    expect(JSON.stringify(logged)).not.toContain(String(EXACT.lat));
  });

  test("unknown people are rejected", () => {
    const { id } = makeLocation();
    expect(
      errorCode(() => createVisit(db, admin, { locationId: id, people: [{ userId: "nope" }] })),
    ).toEqual({ code: "VISIT_PERSON_INVALID", status: 422 });
  });
});

describe("effective status", () => {
  test("a visit makes it visited, a later status change wins, a new visit wins again", () => {
    const { id, version } = makeLocation();
    const row = () => db.select().from(locations).where(eq(locations.id, id)).get()!;
    expect(row().status).toBe("idea");
    createVisit(db, admin, { locationId: id });
    expect(listLocations(db, admin, {}).rows[0]?.status).toBe("visited");
    updateLocation(db, admin, { id, version, status: "demolished" });
    expect(listLocations(db, admin, {}).rows[0]?.status).toBe("demolished");
    expect(listLocations(db, admin, { status: ["visited"] }).rows).toEqual([]);
    createVisit(db, admin, { locationId: id });
    expect(listLocations(db, admin, {}).rows[0]?.status).toBe("visited");
    expect(listLocations(db, admin, { status: ["visited"] }).rows).toHaveLength(1);
    expect(row().status).toBe("demolished");
    expect(row().statusChangedAt).not.toBeNull();
  });

  test("the edit form receives the stored status separately", () => {
    const { id } = makeLocation();
    createVisit(db, admin, { locationId: id });
    const detail = getLocation(db, admin, id);
    expect(detail.location.status).toBe("visited");
    expect(detail.location.storedStatus).toBe("idea");
  });
});

describe("feed, review and timeline", () => {
  test("feed pages are stable, newest first, and filter by author/year", () => {
    const { id } = makeLocation(admin, { visibility: "friends", friendsLevel: "contribute" });
    db.update(locations).set({ country: "DE" }).where(eq(locations.id, id)).run();
    const author = createVisit(db, admin, { locationId: id, journalMd: "eins" }).id;
    createVisit(db, member, { locationId: id, journalMd: "zwei" });

    const first = listFeed(db, admin, { limit: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = listFeed(db, admin, { limit: 1, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
    expect(listFeed(db, admin, { authorId: ADMIN }).rows.map((r) => r.id)).toEqual([author]);
    const year = Number(todayInTz("Etc/UTC").slice(0, 4));
    expect(listFeed(db, admin, { year: year - 1 }).rows).toEqual([]);
    const review = yearReview(db, admin, { year });
    expect(review.visits).toBe(2);
    expect(review.locations).toBe(1);
    expect(review.countries).toBe(1);
    expect(review.months.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test("the timeline merges visits and status changes by date", () => {
    const { id, version } = makeLocation();
    createVisit(db, admin, { locationId: id });
    updateLocation(db, admin, { id, version, status: "sealed" });
    const timeline = getLocationTimeline(db, admin, id);
    expect(timeline.map((e) => e.kind).sort()).toEqual(["status", "visit"]);
    const status = timeline.find((e) => e.kind === "status");
    expect(status).toMatchObject({ from: "idea", to: "sealed" });
    expect(timeline.find((e) => e.kind === "visit")).toHaveProperty("visit");
  });
});
