// Metamorphic privacy test (DESIGN §3.4 rule 5, §13). Move the exact point to
// another place within the fuzz radius by editing the DB directly; every
// response for a viewer below `precise` must be byte-identical.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { AuthCtx, Role } from "../authz/ctx";
import { runMetamorphicPrivacyCheck } from "../authz/metamorphic";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { locations } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createLocation, getLocation, setLocationGrant } from "./service";

const ADMIN = "admin-user";
const MEMBER = "member-user";
const GUEST = "guest-user";
const EXACT = { lat: 51.12345, lon: 7.12345 };
const NEW_EXACT = { lat: EXACT.lat + 0.005, lon: EXACT.lon - 0.003 };

let db: AppDb;
const cases: {
  name: string;
  ctx: AuthCtx;
  role: Role;
  visibility: "private" | "friends";
  friendsLevel: "view" | "contribute" | "precise";
  grant?: "contribute" | "view";
}[] = [
  {
    name: "member, friends/view",
    ctx: ctxFor(MEMBER, "member"),
    role: "member",
    visibility: "friends",
    friendsLevel: "view",
  },
  {
    name: "guest, friends/view",
    ctx: ctxFor(GUEST, "guest"),
    role: "guest",
    visibility: "friends",
    friendsLevel: "view",
  },
  {
    name: "member with a contribute grant on a private location",
    ctx: ctxFor(MEMBER, "member"),
    role: "member",
    visibility: "private",
    friendsLevel: "view",
    grant: "contribute",
  },
];

describe("metamorphic coordinate privacy", () => {
  for (const c of cases) {
    test(c.name, async () => {
      db = createTestDb();
      seed(db, {
        users: [
          { id: ADMIN, role: "admin" },
          { id: MEMBER, role: "member" },
          { id: GUEST, role: "guest" },
        ],
      });
      const { id } = createLocation(db, ctxFor(ADMIN, "admin"), {
        name: "Alte Fabrik",
        categoryId: "cat-industry",
        point: EXACT,
        fuzzRadiusM: 1500,
        visibility: c.visibility,
        friendsLevel: c.friendsLevel,
      });
      if (c.grant) {
        setLocationGrant(db, ctxFor(ADMIN, "admin"), {
          locationId: id,
          principalKind: "user",
          principalId: c.ctx.userId,
          level: c.grant,
        });
      }
      const before = getLocation(db, c.ctx, id);
      expect(before.location.exact).toBe(false);
      expect(before.location.level === "view" || before.location.level === "contribute").toBe(true);

      const { before: snapshots, after } = await runMetamorphicPrivacyCheck(
        db,
        c.ctx,
        id,
        NEW_EXACT,
        {
          exact: EXACT,
        },
      );
      expect(Object.keys(snapshots).sort()).toEqual([
        "bboxExact",
        "bboxPub",
        "findDuplicates",
        "getLocation",
        "list",
        "nearExact",
      ]);
      for (const key of Object.keys(snapshots)) {
        expect(after[key], `${key} changed`).toBe(snapshots[key]);
        expect(snapshots[key]).not.toContain(String(EXACT.lat));
        expect(snapshots[key]).not.toContain(String(EXACT.lon));
      }
      const moved = db.select().from(locations).where(eq(locations.id, id)).get()!;
      expect(moved.lat).toBe(NEW_EXACT.lat);
      expect(moved.lon).toBe(NEW_EXACT.lon);
    });
  }
});
