// Serialization (coordinate privacy), load-or-nothing and permissions.
import { describe, expect, test } from "bun:test";
import { HttpError } from "../auth/context";
import { locations } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { AuthCtx } from "./ctx";
import { LEVELS, type Level, type VisibleLevel } from "./levels";
import { loadLocationForCtx, requireLocationForCtx } from "./load";
import { serializeLocation, serializeLocationsForCtx } from "./serialize";
import { ctxFor, seed } from "./test-fixtures";

const ME = "me";
const OTHER = "other";
const EXACT = { lat: 51.1234567, lon: 7.7654321 };
const PUB = { lat: 51.1299999, lon: 7.7700001 };
const SECRET = "access-text-does-not-matter";
const GRANT_LEVELS = ["view", "contribute", "precise", "edit", "manage"] as const;

function fixture() {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: ME, role: "member" },
      { id: OTHER, role: "member" },
    ],
    locations: [
      ...GRANT_LEVELS.map((level) => ({
        id: `granted-${level}`,
        ownerId: OTHER,
        visibility: "private" as const,
        lat: EXACT.lat,
        lon: EXACT.lon,
        pubLat: PUB.lat,
        pubLon: PUB.lon,
        fuzzRadiusM: 1500,
        accessNotes: SECRET,
        dangerNotes: "Hunde",
        parking: [{ lat: EXACT.lat, lon: EXACT.lon }],
        geomArea: {
          type: "Polygon" as const,
          coordinates: [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      })),
      {
        id: "hidden",
        ownerId: OTHER,
        visibility: "private",
        lat: EXACT.lat,
        lon: EXACT.lon,
        pubLat: PUB.lat,
        pubLon: PUB.lon,
      },
    ],
    grants: GRANT_LEVELS.map((level) => ({
      locationId: `granted-${level}`,
      principalKind: "user" as const,
      principalId: ME,
      level,
    })),
  });
  return db;
}

const rank = (l: Level) => LEVELS.indexOf(l);

describe("serializeLocation", () => {
  for (const role of ["admin", "member", "guest"] as const) {
    test(`${role}: precise-only keys appear exactly at level >= precise`, () => {
      const db = fixture();
      const ctx = ctxFor(ME, role);
      for (const levelName of GRANT_LEVELS) {
        const found = loadLocationForCtx(db, ctx, `granted-${levelName}`);
        if (!found) continue;
        const out = serializeLocation(found.location, found.level);
        const precise = rank(found.level) >= rank("precise");
        const json = JSON.stringify(out);

        expect(Object.keys(out)).not.toContain("lat");
        expect(Object.keys(out)).not.toContain("lon");
        expect(Object.keys(out)).not.toContain("pubLat");
        expect(Object.keys(out)).not.toContain("pubLon");
        expect(Object.keys(out)).not.toContain("nameSort");
        for (const key of ["geomArea", "parking", "accessNotes", "dangerNotes", "fuzzRadiusM"]) {
          expect(Object.keys(out).includes(key)).toBe(precise);
        }
        expect(Object.keys(out).includes("grants")).toBe(rank(found.level) >= rank("manage"));
        expect(out.exact).toBe(precise);
        expect(out.point).toEqual(
          precise ? { lat: EXACT.lat, lon: EXACT.lon } : { lat: PUB.lat, lon: PUB.lon },
        );
        // The exact digits must never appear for a below-precise viewer.
        expect(json.includes(String(EXACT.lat))).toBe(precise);
        expect(json.includes(String(EXACT.lon))).toBe(precise);
        expect(json.includes(SECRET)).toBe(precise);
        expect(out.permissions).toEqual({
          canContribute: rank(found.level) >= rank("contribute"),
          canSeeExact: precise,
          canEdit: rank(found.level) >= rank("edit"),
          canManage: rank(found.level) >= rank("manage"),
        });
      }
      if (role === "guest") {
        const found = loadLocationForCtx(db, ctx, "granted-manage")!;
        expect(found.level).toBe("view");
      }
    });
  }

  test("below precise: absent, not null; identical for null and set fields", () => {
    const base = {
      id: "x",
      lat: 51.1,
      lon: 7.2,
      pubLat: 51.2,
      pubLon: 7.3,
      fuzzRadiusM: 1500,
      geomArea: null,
      parking: null,
      accessNotes: null,
      dangerNotes: null,
    };
    const withValues = {
      ...base,
      fuzzRadiusM: 99,
      accessNotes: "secret",
      parking: [{ lat: 1, lon: 2 }],
    };
    // @ts-expect-error test rows are intentionally partial
    expect(serializeLocation(base, "view")).toEqual(serializeLocation(withValues, "view"));
  });

  test("refuses level none", () => {
    // @ts-expect-error test row is intentionally partial
    expect(() => serializeLocation({ id: "x" }, "none")).toThrow();
  });

  test("a forged level on the row cannot override the caller's level", () => {
    const db = fixture();
    const found = loadLocationForCtx(db, ctxFor(ME, "member"), "granted-view")!;
    // @ts-expect-error forged extra field
    const out = serializeLocation({ ...found.location, level: "manage" }, found.level);
    expect(out.level).toBe("view");
  });

  test("serializeLocationsForCtx serializes a page with per-row levels", () => {
    const db = fixture();
    const ctx = ctxFor(ME, "member");
    const rows = db.select().from(locations).all();
    const out = serializeLocationsForCtx(db, ctx, rows);
    expect(out.map((o) => [o.id, o.level, "parking" in o])).toEqual([
      ["granted-view", "view", false],
      ["granted-contribute", "contribute", false],
      ["granted-precise", "precise", true],
      ["granted-edit", "edit", true],
      ["granted-manage", "manage", true],
    ]);
  });
});

describe("load or nothing", () => {
  test("invisible and nonexistent look like 404, visible-but-below-min like 403", () => {
    const db = fixture();
    const ctx: AuthCtx = ctxFor(ME, "member");
    expect(loadLocationForCtx(db, ctx, "hidden")).toBeNull();
    expect(loadLocationForCtx(db, ctx, "does-not-exist")).toBeNull();
    const errorFor = (id: string, min: VisibleLevel) => {
      try {
        requireLocationForCtx(db, ctx, id, min);
        return null;
      } catch (e) {
        return e instanceof HttpError ? { status: e.status } : e;
      }
    };
    expect(errorFor("hidden", "view")).toEqual({ status: 404 });
    expect(errorFor("does-not-exist", "view")).toEqual(errorFor("hidden", "view"));
    expect(errorFor("granted-view", "edit")).toEqual({ status: 403 });
    expect(requireLocationForCtx(db, ctx, "granted-edit", "edit").location.id).toBe("granted-edit");
  });
});
