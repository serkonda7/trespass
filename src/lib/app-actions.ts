// App-level actions (DESIGN §3.5): what a role may do outside of one location.
// Safe to import on the client — pages use `can` to decide which buttons to
// show, and the server uses the same table (re-exported by server/authz/actions).
// Location-level permissions are different: they come from the server's
// serialization and are never computed in the UI.
import type { Role } from "../server/authz/ctx";

export const APP_ACTIONS = {
  /** Invite users and change roles. */
  inviteUsers: ["admin"],
  manageGroups: ["admin"],
  createLocation: ["admin", "member"],
  createTrip: ["admin", "member"],
  ownEquipment: ["admin", "member"],
  /** Run research jobs and review the inbox. */
  research: ["admin"],
  manageTiles: ["admin"],
  manageSettings: ["admin"],
  /** Admins export everything; members their own and everything visible to them. */
  export: ["admin", "member"],
} as const satisfies Record<string, readonly Role[]>;

export type AppAction = keyof typeof APP_ACTIONS;

export function can(ctx: { role: Role }, action: AppAction): boolean {
  return (APP_ACTIONS[action] as readonly Role[]).includes(ctx.role);
}
