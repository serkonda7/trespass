// App-level actions (DESIGN §3.5): what a role may do outside of one location.
// Location-level permissions will live in their own module when locations land.
import { HttpError } from "../auth/context";
import type { AuthCtx, Role } from "./ctx";

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

export function can(ctx: AuthCtx, action: AppAction): boolean {
  return (APP_ACTIONS[action] as readonly Role[]).includes(ctx.role);
}

/** Throws HttpError(403) unless ctx may perform the action. */
export function requireCan(ctx: AuthCtx, action: AppAction): AuthCtx {
  if (!can(ctx, action)) throw new HttpError(403, "Forbidden");
  return ctx;
}

/** What an export contains. Details are decided when export lands. */
export type ExportScope = "all" | "own_and_visible" | "none";

export function exportScope(ctx: AuthCtx): ExportScope {
  if (ctx.role === "admin") return "all";
  if (ctx.role === "member") return "own_and_visible";
  return "none";
}
