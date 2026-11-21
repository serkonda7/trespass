// Settings server functions: read needs a session, write is admin-only.
// Errors: HttpError codes (shared/error-text.ts).
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { getSettings, updateSettings } from "./service";

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => getSettings(getDb()));

export const updateSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      instanceName: z.string().max(200),
      researchBudgetCents: z.number().int().min(0),
      tileBudgetMb: z.number().int().min(1),
    }),
  )
  .handler(({ context: { ctx }, data }) => updateSettings(getDb(), ctx, data));
