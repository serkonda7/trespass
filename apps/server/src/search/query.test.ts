// Search behaviour and privacy (DESIGN §5.9, §3.4 rules 2–4). Every result
// passes through visibleLocationsWhere in SQL; only view-level fields are
// indexed, so even the owner cannot search precise-only notes.
import { describe, expect, test } from "bun:test";
import type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
import type { Point } from "@trespass/shared/geo/types";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { visibleLocationsWhere } from "../authz/predicates";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { locations } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createLocation, listLocations, setLocationGrant } from "../locations/service";
import { locationsFts } from "./fts";
import { reindexLocations } from "./indexer";
import { prepareSearchText, searchLocations } from "./query";

const ADMIN = "admin-user";
const MEMBER = "member-user";
const GUEST = "guest-user";
const EXACT: Point = { lat: 51.12345, lon: 7.12345 };
const admin = ctxFor(ADMIN, "admin");
const member = ctxFor(MEMBER, "member");
const guest = ctxFor(GUEST, "guest");

function world() {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: ADMIN, role: "admin" },
      { id: MEMBER, role: "member" },
      { id: GUEST, role: "guest" },
    ],
  });
  return db;
}

function found(db: AppDb, ctx: AuthCtx, q: string) {
  return searchLocations(db, ctx, { q, limit: 200 })
    .rows.map((r) => r.name)
    .sort();
}

const create = (db: AppDb, name: string, extra: Record<string, unknown> = {}) =>
  createLocation(db, admin, {
    name,
    categoryId: "cat-sanatorium",
    point: EXACT,
    ...extra,
  });

describe("full-text search", () => {
  test("trigram substrings, diacritics and ß folding", () => {
    const db = world();
    create(db, "Lungenheilstätte");
    create(db, "Sanatorio Abandonado");
    create(db, "Straßenbahn");
    for (const q of ["heilstätte", "heilstatte", "HEILSTATTE"])
      expect(found(db, admin, q)).toEqual(["Lungenheilstätte"]);
    expect(found(db, admin, "sanatorio")).toEqual(["Sanatorio Abandonado"]);
    expect(found(db, admin, "strassenbahn")).toEqual(["Straßenbahn"]);
    expect(found(db, admin, "strasse")).toEqual(["Straßenbahn"]);
  });

  test("description, tags and place are searched; 1–2 chars use name_sort", () => {
    const db = world();
    const { id } = create(db, "Bergwerk", {
      description: "Ein alter Schacht",
      tags: ["Industriekultur"],
    });
    create(db, "Erzberg");
    db.update(locations)
      .set({ country: "Spanien", adminArea: "Andalusien" })
      .where(eq(locations.id, id))
      .run();
    reindexLocations(db, [id]);
    expect(found(db, admin, "schacht")).toEqual(["Bergwerk"]);
    expect(found(db, admin, "industriekultur")).toEqual(["Bergwerk"]);
    expect(found(db, admin, "spanien")).toEqual(["Bergwerk"]);
    expect(found(db, admin, "andalusien")).toEqual(["Bergwerk"]);
    expect(found(db, admin, "be")).toEqual(["Bergwerk"]); // prefix fallback
    expect(found(db, admin, "er")).toEqual(["Erzberg"]); // word prefix, not a substring
    expect(found(db, admin, "%")).toEqual([]); // LIKE wildcards escaped
    expect(prepareSearchText("heilstätte").mode).toBe("fts");
    expect(prepareSearchText("be").mode).toBe("prefix");
  });

  test("FTS operators and quotes in the query are plain text, never syntax", () => {
    const db = world();
    create(db, "Lungenheilstätte");
    for (const q of ['"', "*", "AND", "NEAR(", "-", "a:b", "(((", 'heil"statte', "OR NOT"])
      expect(() => searchLocations(db, admin, { q, limit: 200 })).not.toThrow();
    expect(found(db, admin, "heilstätte")).toEqual(["Lungenheilstätte"]);
  });

  test("precise-only notes are NOT indexed — not even for the owner", () => {
    const db = world();
    const { id } = create(db, "Sichtbarer Ort", {
      accessNotes: "geheimzugang",
      dangerNotes: "geheimzugang",
      description: "öffentlich beschrieben",
      visibility: "friends",
      friendsLevel: "view",
    });
    expect(found(db, admin, "geheimzugang")).toEqual([]); // owner, level = precise
    expect(found(db, member, "geheimzugang")).toEqual([]); // below precise
    expect(found(db, guest, "geheimzugang")).toEqual([]);
    expect(found(db, member, "sichtbarer")).toEqual(["Sichtbarer Ort"]);
    const row = db.select().from(locationsFts).where(eq(locationsFts.locationId, id)).get();
    const json = JSON.stringify(row);
    expect(json).not.toContain("geheimzugang");
    expect(json).not.toContain(String(EXACT.lat));
    expect(json).not.toContain(String(EXACT.lon));
  });

  test("invisible locations never appear; results stay inside the visible set", () => {
    const db = world();
    create(db, "Privater Ort"); // private, owned by admin
    const { id: shared } = create(db, "Geteilter Ort", {
      visibility: "friends",
      friendsLevel: "view",
    });
    setLocationGrant(db, admin, {
      locationId: shared,
      principalKind: "user",
      principalId: MEMBER,
      level: "view",
    });
    expect(found(db, member, "privater")).toEqual([]);
    expect(found(db, guest, "geteilter")).toEqual(["Geteilter Ort"]);
    expect(found(db, admin, "privater")).toEqual(["Privater Ort"]);
  });
});

describe("the map's listLocations uses the same FTS path", () => {
  test("q, filters, row values and cursors agree", () => {
    const db = world();
    create(db, "Lungenheilstätte", { categoryId: "cat-industry" });
    create(db, "Sanatorio Abandonado");
    for (const input of [
      { q: "heilstätte" },
      { q: "sanatorio", categoryId: ["cat-sanatorium"] },
      { q: "ort" },
      {},
    ]) {
      expect(listLocations(db, admin, input)).toEqual(searchLocations(db, admin, input));
    }
    const first = searchLocations(db, admin, { limit: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = searchLocations(db, admin, { limit: 1, cursor: first.nextCursor! });
    expect(second.rows.map((r) => r.id)).not.toContain(first.rows[0]!.id);
  });

  test("multi-word queries AND all terms; short words must be in the name", () => {
    const db = world();
    create(db, "Lungenheilstätte", { description: "Sanatorium in den Bergen" });
    expect(found(db, admin, "heilstätte sanatorium")).toEqual(["Lungenheilstätte"]);
    expect(found(db, admin, "heilstätte unbekannt")).toEqual([]);
    expect(found(db, admin, "lu heilstätte")).toEqual(["Lungenheilstätte"]);
    expect(found(db, admin, "xx heilstätte")).toEqual([]);
  });
});

describe("property: search never escapes the SQL visibility predicate", () => {
  test(`random users, grants and queries (${40} runs)`, () => {
    const roles: Role[] = ["admin", "member", "guest"];
    const levels = ["view", "contribute", "precise", "edit", "manage"] as const;
    const dataset = fc.array(
      fc.record({
        ownerId: fc.constantFrom("a", "b", "c"),
        visibility: fc.constantFrom("private" as const, "friends" as const),
        friendsLevel: fc.constantFrom("view" as const, "contribute" as const, "precise" as const),
        grants: fc.uniqueArray(
          fc.record({
            principalKind: fc.constantFrom("user" as const, "group" as const),
            principalId: fc.constantFrom("a", "b", "c", "g"),
            level: fc.constantFrom(...levels),
          }),
          { maxLength: 3, selector: (g) => `${g.principalKind}/${g.principalId}` },
        ),
      }),
      { maxLength: 10 },
    );
    const ctxArb = fc.record({
      userId: fc.constantFrom("a", "b", "c", "ghost"),
      role: fc.constantFrom(...roles),
      groupIds: fc.uniqueArray(fc.constantFrom("g", "ghost"), { maxLength: 2 }),
    });
    fc.assert(
      fc.property(dataset, ctxArb, (data, raw) => {
        const db = createTestDb();
        seed(db, {
          users: roles.map((role, i) => ({ id: "abc"[i]!, role })),
          groups: ["g"],
          members: [["g", "b"]],
          locations: data.map((x, i) => ({
            id: `l${i}`,
            ownerId: x.ownerId,
            visibility: x.visibility,
            friendsLevel: x.friendsLevel,
          })),
          grants: data.flatMap((x, i) => x.grants.map((g) => ({ locationId: `l${i}`, ...g }))),
        });
        try {
          const ctx: AuthCtx = { ...raw, groupIds: new Set(raw.groupIds) };
          const visible = new Set(
            db
              .select({ id: locations.id })
              .from(locations)
              .where(visibleLocationsWhere(ctx))
              .all()
              .map((r) => r.id),
          );
          for (const q of ["loc", "l0", "nichts"]) {
            const ids = searchLocations(db, ctx, { q, limit: 200 }).rows.map((r) => r.id);
            expect(ids.filter((id) => !visible.has(id))).toEqual([]);
          }
        } finally {
          db.$client.close();
        }
      }),
      { numRuns: 40 },
    );
  });
});
