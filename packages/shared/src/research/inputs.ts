// Zod inputs for the research server functions (admin only, DESIGN §6).
import { z } from "zod";
import { historyPrecisionSchema, isHistoryDate } from "../history/inputs";
import { idSchema, LOCATION_NAME_MAX, TEXT_MAX } from "../locations/inputs";
import { RESEARCH_LANGS } from "./languages";
import { CANDIDATE_KINDS, CANDIDATE_STATUSES } from "./types";

export const AREA_NAME_MAX = 120;
export const AREA_MAX_VERTICES = 200;
/** Keeps Overpass/Wikidata queries polite: roughly 70 × 70 km. */
export const AREA_MAX_KM2 = 5000;
export const AREA_MAX_RADIUS_KM = 40;
export const CANDIDATE_PAGE_SIZE = 30;

export const researchLangSchema = z.enum(RESEARCH_LANGS);

const lonLat = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export const createAreaInput = z.object({
  name: z.string().trim().min(1).max(AREA_NAME_MAX),
  lang: researchLangSchema,
  shape: z.discriminatedUnion("type", [
    /** A drawn polygon, [lon, lat] pairs; the server closes it. */
    z.object({
      type: z.literal("polygon"),
      ring: z
        .array(lonLat)
        .min(3)
        .max(AREA_MAX_VERTICES + 1),
    }),
    /** A circle around an existing pin. */
    z.object({
      type: z.literal("around"),
      locationId: idSchema,
      radiusKm: z.number().finite().min(0.5).max(AREA_MAX_RADIUS_KM),
    }),
  ]),
});
export type CreateAreaInput = z.input<typeof createAreaInput>;

export const updateAreaInput = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(AREA_NAME_MAX),
  lang: researchLangSchema,
});

export const areaIdInput = z.object({ id: idSchema });
export const startScanInput = z.object({
  areaId: idSchema,
  kind: z.enum(["scan.overpass", "scan.wikidata"]),
});
export const startEnrichInput = z.object({ locationId: idSchema });

export const listCandidatesInput = z.object({
  status: z.enum(CANDIDATE_STATUSES).default("inbox"),
  kind: z.enum(CANDIDATE_KINDS).optional(),
  areaId: idSchema.optional(),
  locationId: idSchema.optional(),
  cursor: z.string().max(200).optional(),
});
export type ListCandidatesInput = z.input<typeof listCandidatesInput>;

export const factEditSchema = z
  .object({
    datePrecision: historyPrecisionSchema,
    dateFrom: z.string().trim(),
    dateTo: z.string().trim().nullable().optional(),
    text: z.string().trim().min(1).max(5000),
  })
  .superRefine((v, ctx) => {
    if (!isHistoryDate(v.dateFrom, v.datePrecision))
      ctx.addIssue({ code: "custom", path: ["dateFrom"], message: "HISTORY_DATE_INVALID" });
    if (v.dateTo && (!isHistoryDate(v.dateTo, v.datePrecision) || v.dateTo < v.dateFrom))
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: "HISTORY_DATE_INVALID" });
  });

/**
 * One decision on an inbox candidate:
 *  - accept: new_location → creates a `researched` location; fact → approved
 *    history entry; status_change → sets the location's status.
 *  - later: new_location only, creates an `idea` location ("Ort später prüfen").
 *  - merge: new_location only, its facts and sources go to `targetLocationId`.
 *  - reject: remembered, never suggested again.
 */
export const decideCandidateInput = z.object({
  id: idSchema,
  decision: z.enum(["accept", "later", "merge", "reject"]),
  targetLocationId: idSchema.optional(),
  name: z.string().trim().min(1).max(LOCATION_NAME_MAX).optional(),
  categoryId: idSchema.optional(),
  description: z.string().trim().max(TEXT_MAX).nullable().optional(),
  fact: factEditSchema.optional(),
});
export type DecideCandidateInput = z.input<typeof decideCandidateInput>;
