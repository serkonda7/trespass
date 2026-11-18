// Server functions for visits and the journal. Logic and permission checks
// live in ./service.ts; these add authMiddleware and input validation.
import { createServerFn } from "@tanstack/solid-start";
import {
  createVisitInput,
  feedInput,
  listVisitsInput,
  previewMarkdownInput,
  updateVisitInput,
  visitIdInput,
  yearInput,
} from "~/lib/visits/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { photoEmbedIds, renderJournalMarkdown } from "../markdown";
import { resolvePhotoEmbeds } from "../photos/service";
import {
  createVisit,
  deleteVisit,
  getLocationTimeline,
  getVisit,
  listFeed,
  listVisitsForLocation,
  updateVisit,
  yearReview,
} from "./service";

export const createVisitFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createVisitInput)
  .handler(({ context: { ctx }, data }) => createVisit(getDb(), ctx, data));

export const updateVisitFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateVisitInput)
  .handler(({ context: { ctx }, data }) => updateVisit(getDb(), ctx, data));

export const deleteVisitFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(visitIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteVisit(getDb(), ctx, data.id);
    return { ok: true as const };
  });

export const getVisitFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(visitIdInput)
  .handler(({ context: { ctx }, data }) => getVisit(getDb(), ctx, data.id));

export const listVisitsForLocationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listVisitsInput)
  .handler(({ context: { ctx }, data }) => listVisitsForLocation(getDb(), ctx, data.locationId));

export const listFeedFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(feedInput)
  .handler(({ context: { ctx }, data }) => listFeed(getDb(), ctx, data));

export const yearReviewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(yearInput)
  .handler(({ context: { ctx }, data }) => yearReview(getDb(), ctx, data));

export const getLocationTimelineFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listVisitsInput)
  .handler(({ context: { ctx }, data }) => getLocationTimeline(getDb(), ctx, data.locationId));

/** Markdown preview for the editor; only photos visible to the editor appear. */
export const previewMarkdownFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(previewMarkdownInput)
  .handler(({ context: { ctx }, data }) => {
    const embeds = resolvePhotoEmbeds(getDb(), ctx, photoEmbedIds(data.md));
    return {
      html: renderJournalMarkdown(data.md, { resolvePhoto: (id) => embeds.get(id) ?? null }),
    };
  });
