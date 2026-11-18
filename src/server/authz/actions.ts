// App-level actions (DESIGN §3.5). The table and `can` live in lib/ so pages
// can use the same check as the server without importing server modules.
import { HttpError } from "../auth/context";
import type { AuthCtx } from "./ctx";

export {
  APP_ACTIONS,
  type AppAction,
  can,
} from "../../lib/app-actions";

import { type AppAction, can } from "../../lib/app-actions";

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
