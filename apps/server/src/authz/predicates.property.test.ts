// Property test (DESIGN §3.4 rule 3, §13): on random data in a real SQLite
// database the SQL predicates select exactly the locations where
// locationLevel >= min, for every min, and the loader agrees. Includes
// anomalies the app would never write: guest owners, ghost principals and
// colliding user/group ids.
import { describe, expect, test } from "bun:test";
import type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
import { and, eq, not } from "drizzle-orm";
import fc from "fast-check";
import { loadAuthCtx } from "../auth/users";
import type { AppDb } from "../db/client";
import { type LocationGrant, locationGrants, locations } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { atLeast, locationLevel, type VisibleLevel } from "./levels";
import { loadLocationForCtx, locationLevels } from "./load";
import { locationsAtLeastWhere, visibleLocationsWhere } from "./predicates";
import { seed } from "./test-fixtures";

const NUM_RUNS = 150;
const IDS = ["a", "b", "c", "d", "e", "f"] as const;
const GHOST = "ghost";
const ROLES: Role[] = ["admin", "member", "guest"];
const MINS: VisibleLevel[] = ["view", "contribute", "precise", "edit", "manage"];
const FRIEND_LEVELS = ["view", "contribute", "precise"] as const;

const datasetArb = fc
  .record({
    users: fc.uniqueArray(
      fc.record({ id: fc.constantFrom(...IDS), role: fc.constantFrom(...ROLES) }),
      { minLength: 1, maxLength: 5, selector: (u) => u.id },
    ),
    groups: fc.uniqueArray(fc.constantFrom(...IDS), { maxLength: 4 }),
  })
  .chain(({ users, groups }) => {
    const userIds = users.map((u) => u.id);
    const anyId = fc.constantFrom<string>(...IDS, GHOST);
    const members =
      groups.length === 0
        ? fc.constant([] as [string, string][])
        : fc.uniqueArray(fc.tuple(fc.constantFrom(...groups), fc.constantFrom(...userIds)), {
            maxLength: 12,
            selector: ([g, u]) => `${g}/${u}`,
          });
    const grant = fc.record({
      principalKind: fc.constantFrom("user" as const, "group" as const),
      principalId: anyId,
      level: fc.constantFrom<VisibleLevel>(...MINS),
    });
    // owner_id has an FK, so owners must exist (guests and disabled users are
    // still allowed as anomalies). Grants may reference deleted principals.
    const locationsArb = fc.array(
      fc.record({
        ownerId: fc.constantFrom(...userIds),
        visibility: fc.constantFrom("private" as const, "friends" as const),
        friendsLevel: fc.constantFrom(...FRIEND_LEVELS),
        grants: fc.uniqueArray(grant, {
          maxLength: 5,
          selector: (g) => `${g.principalKind}/${g.principalId}`,
        }),
      }),
      { maxLength: 20 },
    );
    return fc.record({
      users: fc.constant(users),
      groups: fc.constant(groups),
      members,
      locations: locationsArb,
    });
  });

const ctxArb = fc.record({
  userId: fc.constantFrom<string>(...IDS, GHOST),
  role: fc.constantFrom(...ROLES),
  groupIds: fc.uniqueArray(fc.constantFrom<string>(...IDS, GHOST), { maxLength: 4 }),
});

type Dataset = typeof datasetArb extends fc.Arbitrary<infer T> ? T : never;

function build(data: Dataset): AppDb {
  const db = createTestDb();
  seed(db, {
    users: data.users,
    groups: data.groups,
    members: data.members,
    locations: data.locations.map((x, i) => ({
      id: `l${i}`,
      ownerId: x.ownerId,
      visibility: x.visibility,
      friendsLevel: x.friendsLevel,
    })),
    grants: data.locations.flatMap((x, i) => x.grants.map((g) => ({ locationId: `l${i}`, ...g }))),
  });
  return db;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

function checkCtx(db: AppDb, ctx: AuthCtx) {
  const rows = db.select().from(locations).all();
  const grants = db.select().from(locationGrants).all();
  const byLocation = new Map<string, LocationGrant[]>();
  for (const g of grants)
    byLocation.set(g.locationId, [...(byLocation.get(g.locationId) ?? []), g]);
  const levels = new Map(
    rows.map((row) => [row.id, locationLevel(ctx, row, byLocation.get(row.id) ?? [])]),
  );

  for (const min of MINS) {
    const want = ids(
      rows.filter((r) => atLeast(levels.get(r.id)!, min)).map((r) => ({ id: r.id })),
    );
    const pred = locationsAtLeastWhere(ctx, min);
    const got = ids(db.select({ id: locations.id }).from(locations).where(pred).all());
    expect({ ctx: { ...ctx, groupIds: [...ctx.groupIds] }, min, got }).toEqual({
      ctx: { ...ctx, groupIds: [...ctx.groupIds] },
      min,
      got: want,
    });
    // Never NULL: NOT gives the exact complement.
    const complement = ids(db.select({ id: locations.id }).from(locations).where(not(pred)).all());
    expect(complement.length + got.length).toBe(rows.length);
    expect(complement.filter((id) => got.includes(id))).toEqual([]);
  }
  expect(
    ids(db.select({ id: locations.id }).from(locations).where(visibleLocationsWhere(ctx)).all()),
  ).toEqual(
    ids(
      db
        .select({ id: locations.id })
        .from(locations)
        .where(locationsAtLeastWhere(ctx, "view"))
        .all(),
    ),
  );

  const batch = locationLevels(db, ctx, rows);
  for (const row of rows) expect(batch.get(row.id)).toBe(levels.get(row.id)!);
  for (const row of rows) {
    expect(loadLocationForCtx(db, ctx, row.id)?.level ?? "none").toBe(levels.get(row.id)!);
  }
}

describe("locationsAtLeastWhere / visibleLocationsWhere agree with locationLevel", () => {
  test(`random data and random ctxs (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(datasetArb, fc.array(ctxArb, { minLength: 1, maxLength: 4 }), (data, ctxs) => {
        const db = build(data);
        try {
          for (const c of ctxs) checkCtx(db, { ...c, groupIds: new Set(c.groupIds) });
          for (const u of data.users) {
            const ctx = loadAuthCtx(db, u.id);
            if (ctx) checkCtx(db, ctx);
          }
        } finally {
          db.$client.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);
});

describe("composition", () => {
  test("the predicate ANDs with filters and survives a grants join", () => {
    const db = createTestDb();
    seed(db, {
      users: [
        { id: "me", role: "member" },
        { id: "x", role: "member" },
      ],
      locations: [
        { id: "p", ownerId: "x", visibility: "private" },
        { id: "q", ownerId: "x", visibility: "friends", friendsLevel: "contribute" },
        { id: "r", ownerId: "me", visibility: "private" },
      ],
      grants: [{ locationId: "p", principalKind: "user", principalId: "me", level: "view" }],
    });
    const ctx: AuthCtx = { userId: "me", role: "member", groupIds: new Set() };
    expect(
      ids(
        db
          .select({ id: locations.id })
          .from(locations)
          .where(and(visibleLocationsWhere(ctx), eq(locations.visibility, "friends")))
          .all(),
      ),
    ).toEqual(["q"]);
    const joined = db
      .selectDistinct({ id: locations.id })
      .from(locations)
      .innerJoin(locationGrants, eq(locationGrants.locationId, locations.id))
      .where(locationsAtLeastWhere(ctx, "view"))
      .all();
    expect(ids(joined)).toEqual(["p"]);
    db.$client.close();
  });
});
