// How server functions get AuthCtx: `.middleware([authMiddleware])`, then
// `context.ctx`. Signed out → 401; roleMiddleware adds a 403 role check.
import { createMiddleware } from "@tanstack/solid-start";
import type { Role } from "@trespass/shared/authz/ctx";
import { requireAuthCtx, requireRole } from "./session";

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const ctx = await requireAuthCtx();
  return next({ context: { ctx } });
});

export const roleMiddleware = (...roles: Role[]) =>
  createMiddleware({ type: "function" })
    .middleware([authMiddleware])
    .server(({ next, context }) => {
      requireRole(context.ctx, ...roles);
      return next();
    });
