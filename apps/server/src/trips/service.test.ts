import { beforeEach, describe, expect, test } from "bun:test";
import { failure } from "../authz/test-errors";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { createTestDb } from "../db/test-db";
import { createEquipment, createTemplate } from "../equipment/service";
import { createLocation } from "../locations/service";
import { createVisit, getVisit } from "../visits/service";
import {
  addChecklistItem,
  addTemplateToTrip,
  addTripStop,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  removeChecklistItem,
  setChecklistPacked,
  setTripStops,
  updateTrip,
} from "./service";

const admin = ctxFor("admin", "admin");
const owner = ctxFor("owner", "member");
const friend = ctxFor("friend", "member");
const stranger = ctxFor("stranger", "member");
const guest = ctxFor("guest", "guest");
const EXACT = { lat: 51.12345, lon: 7.12345 };
let db: AppDb;
let shared: string;
let secret: string;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: "admin", role: "admin" },
      { id: "owner", role: "member" },
      { id: "friend", role: "member" },
      { id: "stranger", role: "member" },
      { id: "guest", role: "guest" },
    ],
  });
  shared = createLocation(db, owner, {
    name: "Geteilt",
    categoryId: "cat-industry",
    point: EXACT,
    visibility: "friends",
    friendsLevel: "contribute",
  }).id;
  secret = createLocation(db, owner, {
    name: "Geheim",
    categoryId: "cat-industry",
    point: { lat: 51.2, lon: 7.3 },
  }).id;
});

const makeTrip = () =>
  createTrip(db, owner, {
    title: "Ruhrgebiet",
    startsOn: "2026-12-01",
    endsOn: "2026-12-02",
    people: [{ userId: "friend" }, { userId: "guest" }, { name: "Kai" }],
    emergencyContact: { name: "Mia", email: "mia@example.org" },
    locationIds: [shared, secret],
  }).id;

describe("trip visibility", () => {
  test("owner, listed people and admins see the trip; others get 404", () => {
    const id = makeTrip();
    expect(getTrip(db, owner, id).title).toBe("Ruhrgebiet");
    expect(getTrip(db, friend, id).people.map((p) => p.displayName)).toEqual([
      "friend",
      "guest",
      "Kai",
    ]);
    expect(getTrip(db, admin, id).stops).toHaveLength(2);
    expect(failure(() => getTrip(db, stranger, id))).toEqual({
      status: 404,
      code: "TRIP_NOT_FOUND",
    });
    expect(listTrips(db, stranger)).toEqual([]);
    expect(listTrips(db, friend).map((t) => t.id)).toEqual([id]);
  });

  test("stops never widen location access: invisible stops are absent, others fuzzed", () => {
    const id = makeTrip();
    const seen = getTrip(db, friend, id);
    expect(seen.stops.map((s) => s.location.id)).toEqual([shared]);
    expect(seen.stops[0]!.location.exact).toBe(false);
    expect(seen.stops[0]!.location.point).not.toEqual(EXACT);
    expect(JSON.stringify(seen)).not.toContain("51.12345");
    expect(seen.hiddenStops).toBeUndefined();
    expect(listTrips(db, friend)[0]!.stopCount).toBe(1);
    const mine = getTrip(db, owner, id);
    expect(mine.stops[0]!.location.point).toEqual(EXACT);
    expect(mine.hiddenStops).toBe(0);
  });

  test("an editor's reorder keeps stops they can no longer see", () => {
    const id = makeTrip();
    // The admin adds a stop the owner cannot see.
    const extra = createLocation(db, admin, {
      name: "Admin-Ort",
      categoryId: "cat-industry",
      point: { lat: 50, lon: 6 },
    }).id;
    addTripStop(db, admin, { tripId: id, locationId: extra });
    expect(getTrip(db, owner, id).hiddenStops).toBe(1);
    const after = setTripStops(db, owner, { id, locationIds: [secret, shared] });
    expect(after.stops.map((s) => s.location.id)).toEqual([secret, shared]);
    expect(getTrip(db, admin, id).stops.map((s) => s.location.id)).toEqual([secret, shared, extra]);
    expect(failure(() => setTripStops(db, owner, { id, locationIds: [extra] }))).toEqual({
      status: 422,
      code: "TRIP_STOP_INVALID",
    });
  });
});

describe("trip edits", () => {
  test("only the owner or an admin edits; people may tick, guests may not", () => {
    const id = makeTrip();
    const trip = getTrip(db, owner, id);
    expect(
      failure(() => updateTrip(db, friend, { id, version: trip.version, title: "x" })),
    ).toEqual({
      status: 403,
      code: "TRIP_FORBIDDEN",
    });
    const { version } = updateTrip(db, owner, { id, version: trip.version, status: "active" });
    expect(
      failure(() => updateTrip(db, owner, { id, version: trip.version, title: "x" }))?.code,
    ).toBe("VERSION_CONFLICT");
    expect(version).toBe(trip.version + 1);
    const item = addChecklistItem(db, owner, { tripId: id, label: "Wasser" });
    setChecklistPacked(db, friend, { id: item.id, packed: true });
    expect(getTrip(db, owner, id).checklist[0]!.packed).toBe(true);
    expect(
      failure(() => setChecklistPacked(db, guest, { id: item.id, packed: false }))?.status,
    ).toBe(403);
    expect(failure(() => setChecklistPacked(db, stranger, { id: item.id, packed: false }))).toEqual(
      {
        status: 404,
        code: "CHECKLIST_ITEM_NOT_FOUND",
      },
    );
    expect(failure(() => removeChecklistItem(db, friend, item.id))?.status).toBe(403);
    expect(failure(() => createTrip(db, guest, { title: "x" }))?.status).toBe(403);
  });

  test("templates merge into the packing list without duplicates", () => {
    const id = makeTrip();
    const lamp = createEquipment(db, owner, { name: "Lampe", needsCharging: true });
    const gloves = createEquipment(db, owner, { name: "Handschuhe" });
    const a = createTemplate(db, owner, { name: "A", equipmentIds: [lamp.id] });
    const b = createTemplate(db, owner, { name: "B", equipmentIds: [lamp.id, gloves.id] });
    expect(addTemplateToTrip(db, owner, { tripId: id, templateId: a.id })).toEqual({ added: 1 });
    expect(addTemplateToTrip(db, owner, { tripId: id, templateId: b.id })).toEqual({ added: 1 });
    const list = getTrip(db, friend, id).checklist;
    expect(list.map((i) => [i.label, i.needsCharging])).toEqual([
      ["Lampe", true],
      ["Handschuhe", false],
    ]);
    const foreign = createTemplate(db, friend, { name: "F" });
    expect(
      failure(() => addTemplateToTrip(db, owner, { tripId: id, templateId: foreign.id })),
    ).toEqual({ status: 404, code: "TEMPLATE_NOT_FOUND" });
  });

  test("people and contacts are validated", () => {
    expect(
      failure(() => createTrip(db, owner, { title: "x", people: [{ userId: "nobody" }] })),
    ).toEqual({ status: 422, code: "TRIP_PERSON_INVALID" });
    expect(
      failure(() => createTrip(db, owner, { title: "x", emergencyContact: { name: "Mia" } })),
    ).toEqual({ status: 422, code: "EMERGENCY_CONTACT_INVALID" });
    expect(
      failure(() =>
        createTrip(db, owner, { title: "x", startsOn: "2026-12-02", endsOn: "2026-12-01" }),
      ),
    ).toEqual({ status: 422, code: "TRIP_DATES_INVALID" });
    expect(failure(() => createTrip(db, owner, { title: "x", locationIds: ["missing"] }))).toEqual({
      status: 422,
      code: "TRIP_STOP_INVALID",
    });
  });

  test("visits link to visible trips; deleting the trip keeps the visits", () => {
    const id = makeTrip();
    expect(failure(() => createVisit(db, stranger, { locationId: shared, tripId: id }))).toEqual({
      status: 404,
      code: "TRIP_NOT_FOUND",
    });
    const visit = createVisit(db, friend, { locationId: shared, tripId: id });
    expect(getTrip(db, owner, id).visits.map((v) => v.id)).toEqual([visit.id]);
    deleteTrip(db, owner, id);
    expect(getVisit(db, friend, visit.id).id).toBe(visit.id);
  });
});
