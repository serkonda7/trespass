// Server functions for history entries and sources. Logic and permission
// checks live in ./service.ts; these add authMiddleware and input validation.
import { createServerFn } from "@tanstack/solid-start";
import {
  approveHistoryInput,
  createHistoryInput,
  historyIdInput,
  listHistoryInput,
  updateHistoryInput,
} from "@trespass/shared/history/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import {
  approveHistory,
  createHistory,
  deleteHistory,
  listHistory,
  updateHistory,
} from "./service";

export const listHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listHistoryInput)
  .handler(({ context: { ctx }, data }) => listHistory(getDb(), ctx, data.locationId));

export const createHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createHistoryInput)
  .handler(({ context: { ctx }, data }) => createHistory(getDb(), ctx, data));

export const updateHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateHistoryInput)
  .handler(({ context: { ctx }, data }) => updateHistory(getDb(), ctx, data));

export const approveHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(approveHistoryInput)
  .handler(({ context: { ctx }, data }) => approveHistory(getDb(), ctx, data));

export const deleteHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(historyIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteHistory(getDb(), ctx, data.id);
    return { ok: true as const };
  });
