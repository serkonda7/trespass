// Zod inputs for history entries and their sources (DESIGN §5.4). Shared by
// the forms and the service (which parses again).
import { z } from "zod";
import { idSchema } from "../locations/inputs";
import { isoDay } from "../visits/inputs";

export const HISTORY_TEXT_MAX = 5000;
export const MAX_SOURCES = 20;

export const HISTORY_PRECISIONS = ["day", "month", "year", "decade", "circa"] as const;
export type HistoryPrecision = (typeof HISTORY_PRECISIONS)[number];
export const historyPrecisionSchema = z.enum(HISTORY_PRECISIONS);
export const historyStatusSchema = z.enum(["draft", "approved"]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/** True when `value` has exactly the ISO parts the precision needs. */
export function isHistoryDate(value: string, precision: HistoryPrecision): boolean {
  if (precision === "day") return DAY.test(value) && isoDay.safeParse(value).success;
  if (precision === "month") return MONTH.test(value);
  return YEAR.test(value) && value !== "0000";
}

/** Decades are stored as their first year ("1923" → "1920"). */
export function normalizeHistoryDate(value: string, precision: HistoryPrecision): string {
  if (precision !== "decade") return value;
  return String(Math.floor(Number(value) / 10) * 10).padStart(4, "0");
}

/** Only http(s) URLs; nothing else is ever sent to archive.org or linked. */
export const sourceUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, "SOURCE_URL_INVALID");

export const sourceInput = z.object({
  /** Present when an existing source is kept (its archive copy stays). */
  id: idSchema.optional(),
  url: sourceUrlSchema,
  title: z.string().trim().max(300).nullable().optional(),
  retrievedOn: isoDay.optional(),
  excerpt: z.string().trim().max(2000).nullable().optional(),
});
export type SourceInput = z.input<typeof sourceInput>;

const datesRefine = (
  v: { datePrecision?: HistoryPrecision; dateFrom?: string; dateTo?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (!v.datePrecision || v.dateFrom === undefined) return;
  if (!isHistoryDate(v.dateFrom, v.datePrecision))
    ctx.addIssue({ code: "custom", path: ["dateFrom"], message: "HISTORY_DATE_INVALID" });
  if (v.dateTo) {
    if (!isHistoryDate(v.dateTo, v.datePrecision))
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: "HISTORY_DATE_INVALID" });
    else if (v.dateTo < v.dateFrom)
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: "HISTORY_DATE_INVALID" });
  }
};

export const createHistoryInput = z
  .object({
    locationId: idSchema,
    datePrecision: historyPrecisionSchema,
    dateFrom: z.string().trim(),
    dateTo: z.string().trim().nullable().optional(),
    text: z.string().trim().min(1).max(HISTORY_TEXT_MAX),
    status: historyStatusSchema.default("approved"),
    sources: z.array(sourceInput).max(MAX_SOURCES).default([]),
  })
  .superRefine(datesRefine);
export type CreateHistoryInput = z.input<typeof createHistoryInput>;

/** Precision and both dates change together. `sources` replaces the list. */
export const updateHistoryInput = z
  .object({
    id: idSchema,
    version: z.number().int().min(1),
    datePrecision: historyPrecisionSchema.optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().nullable().optional(),
    text: z.string().trim().min(1).max(HISTORY_TEXT_MAX).optional(),
    sources: z.array(sourceInput).max(MAX_SOURCES).optional(),
  })
  .superRefine((v, ctx) => {
    const anyDate =
      v.datePrecision !== undefined || v.dateFrom !== undefined || v.dateTo !== undefined;
    if (anyDate && (v.datePrecision === undefined || v.dateFrom === undefined))
      ctx.addIssue({ code: "custom", path: ["dateFrom"], message: "HISTORY_DATE_INVALID" });
    datesRefine(v, ctx);
  });
export type UpdateHistoryInput = z.input<typeof updateHistoryInput>;

export const historyIdInput = z.object({ id: idSchema });
export const approveHistoryInput = z.object({ id: idSchema, version: z.number().int().min(1) });
export const listHistoryInput = z.object({ locationId: idSchema });
