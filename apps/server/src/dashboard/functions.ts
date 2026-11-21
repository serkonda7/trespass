// Server function for the dashboard. Logic lives in ./service.ts.
import { createServerFn } from "@tanstack/solid-start";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { getDashboard } from "./service";

export const getDashboardFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context: { ctx } }) => getDashboard(getDb(), ctx));
