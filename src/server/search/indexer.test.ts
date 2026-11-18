// The index is maintained inside the same transactions as the writes
// (DESIGN §5.9). This test proves that every write path that touches an
// indexed field — create, update, tags, delete and reverse geocoding — leaves
// the index equal to a fresh rebuild.
import { describe, expect, test } from "bun:test";
import type { Point } from "../../lib/geo/types";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { createTestDb } from "../db/test-db";
import { handleReverseGeocode } from "../geocode/handler";
import { geocodeEnabled, resetGeocodeThrottle } from "../geocode/reverse";
import { createLocation, deleteLocation, updateLocation } from "../locations/service";
import { locationsFts } from "./fts";
import {
  ensureSearchIndex,
  rebuildSearchIndex,
  reindexLocations,
  searchIndexOutOfStep,
} from "./indexer";
import { searchLocations } from "./query";

const ADMIN = "admin-user";
const EXACT: Point = { lat: 51.12345, lon: 7.12345 };
const admin = ctxFor(ADMIN, "admin");

function world() {
  const db = createTestDb();
  seed(db, { users: [{ id: ADMIN, role: "admin" }] });
  return db;
}

function found(db: AppDb, q: string) {
  return searchLocations(db, admin, { q, limit: 200 })
    .rows.map((r) => r.name)
    .sort();
}

const snapshot = (db: AppDb) =>
  db
    .select()
    .from(locationsFts)
    .all()
    .sort((a, b) => a.locationId.localeCompare(b.locationId));

function expectConsistent(db: AppDb) {
  expect(searchIndexOutOfStep(db)).toBe(false);
  const before = snapshot(db);
  rebuildSearchIndex(db);
  expect(snapshot(db)).toEqual(before);
}

const create = (db: AppDb, name: string, extra: Record<string, unknown> = {}) =>
  createLocation(db, admin, {
    name,
    categoryId: "cat-industry",
    point: EXACT,
    ...extra,
  });

describe("locations_fts stays in step with every write", () => {
  test("create, update (name, description), tag changes and delete", () => {
    const db = world();
    const { id, version } = create(db, "Alte Fabrik", {
      description: "Baustelle",
      tags: ["Ruine"],
    });
    expect(found(db, "fabrik")).toEqual(["Alte Fabrik"]);
    expect(found(db, "baustelle")).toEqual(["Alte Fabrik"]);
    expect(found(db, "ruine")).toEqual(["Alte Fabrik"]);
    expectConsistent(db);

    updateLocation(db, admin, {
      id,
      version,
      name: "Neue Fabrik",
      description: "Kran",
      tags: ["Industrie"],
    });
    expect(found(db, "fabrik")).toEqual(["Neue Fabrik"]);
    expect(found(db, "baustelle")).toEqual([]);
    expect(found(db, "kran")).toEqual(["Neue Fabrik"]);
    expect(found(db, "ruine")).toEqual([]);
    expect(found(db, "industrie")).toEqual(["Neue Fabrik"]);
    expectConsistent(db);

    deleteLocation(db, admin, id);
    expect(found(db, "fabrik")).toEqual([]);
    expect(snapshot(db)).toEqual([]);
    expectConsistent(db);
  });

  test("an explicit reindex also fixes raw writes (e.g. a restore script)", () => {
    const db = world();
    const { id } = create(db, "Hafen");
    // Raw update the way a migration or fixture would, then reindex explicitly.
    db.$client
      .query("UPDATE locations SET name = ?, name_sort = ? WHERE id = ?")
      .run("Hafenkante", "hafenkante", id);
    expect(found(db, "hafenkante")).toEqual([]); // stale until reindexed
    reindexLocations(db, [id]);
    expect(found(db, "hafenkante")).toEqual(["Hafenkante"]);
    expectConsistent(db);
  });

  test("reverse geocoding reindexes place (country + admin area)", async () => {
    if (!geocodeEnabled()) return; // GEOCODE=off disables the job entirely
    const db = world();
    const { id } = create(db, "Bahnhof");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ address: { country: "Deutschland", state: "Bayern" } }),
    })) as unknown as typeof fetch;
    resetGeocodeThrottle();
    try {
      await handleReverseGeocode(
        { locationId: id, lat: EXACT.lat, lon: EXACT.lon },
        { db, job: {} as never, signal: new AbortController().signal },
      );
    } finally {
      globalThis.fetch = originalFetch;
      resetGeocodeThrottle();
    }
    expect(found(db, "deutschland")).toEqual(["Bahnhof"]);
    expect(found(db, "bayern")).toEqual(["Bahnhof"]);
    expectConsistent(db);
  });
});

describe("rebuild", () => {
  test("an empty or partial index is detected and rebuilt at startup/first search", () => {
    const db = world();
    create(db, "Säge");
    expect(ensureSearchIndex(db)).toBe(false);
    db.delete(locationsFts).run();
    expect(searchIndexOutOfStep(db)).toBe(true);
    expect(ensureSearchIndex(db)).toBe(true);
    expect(found(db, "sage")).toEqual(["Säge"]);
    db.insert(locationsFts).values({ locationId: "ghost", name: "x" }).run();
    expect(searchIndexOutOfStep(db)).toBe(true);
    expect(ensureSearchIndex(db)).toBe(true);
    expect(searchIndexOutOfStep(db)).toBe(false);
    expectConsistent(db);
    expect(rebuildSearchIndex(db)).toBe(1);
  });

  test("a fresh db with raw seeded locations is backfilled before the first search", () => {
    const db = createTestDb();
    seed(db, {
      users: [{ id: ADMIN, role: "admin" }],
      locations: [
        {
          id: "raw",
          ownerId: ADMIN,
          name: "Rohdaten",
          nameSort: "rohdaten",
        },
      ],
    });
    expect(searchIndexOutOfStep(db)).toBe(true);
    expect(found(db, "rohdaten")).toEqual(["Rohdaten"]);
    expect(searchIndexOutOfStep(db)).toBe(false);
  });
});
