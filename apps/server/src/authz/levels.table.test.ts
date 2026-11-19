// Table-driven tests for DESIGN §3.3: role × ownership × visibility ×
// friends_level × grant. Expected values are computed from a literal
// transcription of the design table, not from the module under test.
import { beforeAll, expect, test } from "bun:test";
import type { Role } from "@trespass/shared/authz/ctx";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { locations } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { atLeast, LEVELS, type Level, locationLevel, type VisibleLevel } from "./levels";
import { loadLocationForCtx, locationLevels } from "./load";
import { locationsAtLeastWhere, visibleLocationsWhere } from "./predicates";
import { ctxFor, seed } from "./test-fixtures";

const ME = "me";
const OTHER = "other";
const MY_GROUP = "g-mine";
const OTHER_GROUP = "g-other";
const ORDER: Level[] = ["none", "view", "contribute", "precise", "edit", "manage"];
const max = (a: Level, b: Level): Level => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const min = (a: Level, b: Level): Level => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const MINS: VisibleLevel[] = ["view", "contribute", "precise", "edit", "manage"];
const GRANT_LEVELS: VisibleLevel[] = ["view", "contribute", "precise", "edit", "manage"];
const FRIEND_LEVELS = ["view", "contribute", "precise"] as const;

type GrantCase = {
  name: string;
  grant?: { principalKind: "user" | "group"; principalId: string; level: VisibleLevel };
  expected: Level;
};
const GRANT_CASES: GrantCase[] = [
  { name: "no grant", expected: "none" },
  ...GRANT_LEVELS.map((level) => ({
    name: `${level} to me`,
    grant: { principalKind: "user" as const, principalId: ME, level },
    expected: level,
  })),
  ...GRANT_LEVELS.map((level) => ({
    name: `${level} via my group`,
    grant: { principalKind: "group" as const, principalId: MY_GROUP, level },
    expected: level,
  })),
  ...GRANT_LEVELS.map((level) => ({
    name: `${level} to someone else`,
    grant: { principalKind: "user" as const, principalId: OTHER, level },
    expected: "none" as Level,
  })),
  ...GRANT_LEVELS.map((level) => ({
    name: `${level} to a group I am not in`,
    grant: { principalKind: "group" as const, principalId: OTHER_GROUP, level },
    expected: "none" as Level,
  })),
];

type Case = {
  id: string;
  role: Role;
  ownerId: string;
  visibility: "private" | "friends";
  friendsLevel: (typeof FRIEND_LEVELS)[number];
  grantCase: GrantCase;
};

const CASES: Case[] = [];
for (const role of ["admin", "member", "guest"] as const)
  for (const ownerId of [ME, OTHER])
    for (const visibility of ["private", "friends"] as const)
      for (const friendsLevel of FRIEND_LEVELS)
        for (const grantCase of GRANT_CASES)
          CASES.push({
            id: `l${CASES.length}`,
            role,
            ownerId,
            visibility,
            friendsLevel,
            grantCase,
          });

function expected(c: Case): Level {
  if (c.role === "admin") return "manage";
  let base: Level = c.ownerId === ME ? "manage" : "none";
  if (base !== "manage" && c.visibility === "friends") {
    base = c.friendsLevel;
    if (c.role === "guest") base = min(base, "view");
  }
  const ceiling: Level = c.role === "guest" ? "view" : "manage";
  return min(max(base, c.grantCase.expected), ceiling);
}

let db: AppDb;
beforeAll(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: ME, role: "member" },
      { id: OTHER, role: "member" },
    ],
    groups: [MY_GROUP, OTHER_GROUP],
    members: [
      [MY_GROUP, ME],
      [OTHER_GROUP, OTHER],
    ],
    locations: CASES.map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      visibility: c.visibility,
      friendsLevel: c.friendsLevel,
    })),
    grants: CASES.flatMap((c) =>
      c.grantCase.grant ? [{ locationId: c.id, ...c.grantCase.grant }] : [],
    ),
  });
});

test("the table covers every combination", () => {
  expect(CASES.length).toBe(3 * 2 * 2 * 3 * GRANT_CASES.length);
  expect(GRANT_CASES.length).toBe(21);
});

for (const c of CASES) {
  const want = expected(c);
  test(`${c.role}, ${c.ownerId === ME ? "own" : "other"}, ${c.visibility}, ${c.friendsLevel}, ${c.grantCase.name} -> ${want}`, () => {
    const ctx = ctxFor(ME, c.role, [MY_GROUP]);
    const row = db.select().from(locations).where(eq(locations.id, c.id)).get()!;

    const grants = c.grantCase.grant ? [{ locationId: c.id, ...c.grantCase.grant }] : [];
    expect(locationLevel(ctx, row, grants)).toBe(want);
    expect(locationLevels(db, ctx, [row]).get(c.id)).toBe(want);
    expect(loadLocationForCtx(db, ctx, c.id)?.level ?? "none").toBe(want);

    for (const m of MINS) {
      const hit = db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, c.id), locationsAtLeastWhere(ctx, m)))
        .get();
      expect(!!hit, `min ${m}`).toBe(atLeast(want, m));
    }
    const visible = db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, c.id), visibleLocationsWhere(ctx)))
      .get();
    expect(!!visible).toBe(atLeast(want, "view"));
  });
}

test("LEVELS has the designed order", () => {
  expect(LEVELS).toEqual(["none", "view", "contribute", "precise", "edit", "manage"]);
});
