import { describe, expect, test } from "bun:test";
import type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
import { type AppAction, can, exportScope, requireCan } from "./actions";

const ctx = (role: Role): AuthCtx => ({ userId: "u", role, groupIds: new Set() });

// DESIGN §3.5, transcribed.
const TABLE: Record<AppAction, Record<Role, boolean>> = {
  inviteUsers: { admin: true, member: false, guest: false },
  manageGroups: { admin: true, member: false, guest: false },
  createLocation: { admin: true, member: true, guest: false },
  createTrip: { admin: true, member: true, guest: false },
  ownEquipment: { admin: true, member: true, guest: false },
  research: { admin: true, member: false, guest: false },
  manageTiles: { admin: true, member: false, guest: false },
  manageSettings: { admin: true, member: false, guest: false },
  export: { admin: true, member: true, guest: false },
};

describe("app-level actions", () => {
  for (const [action, row] of Object.entries(TABLE) as [AppAction, Record<Role, boolean>][])
    for (const role of ["admin", "member", "guest"] as const)
      test(`${role} ${row[role] ? "may" : "may not"} ${action}`, () => {
        expect(can(ctx(role), action)).toBe(row[role]);
        if (row[role]) expect(requireCan(ctx(role), action)).toEqual(ctx(role));
        else
          expect(() => requireCan(ctx(role), action)).toThrow(
            expect.objectContaining({ status: 403 }),
          );
      });

  test("export scope", () => {
    expect(exportScope(ctx("admin"))).toBe("all");
    expect(exportScope(ctx("member"))).toBe("own_and_visible");
    expect(exportScope(ctx("guest"))).toBe("none");
  });
});
