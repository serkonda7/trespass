// Zod inputs shared by the visit forms and the service (which parses again).
import { z } from "zod";
import { idSchema } from "../locations/inputs";

export const JOURNAL_MAX = 20_000;
export const HAZARD_MAX = 60;
export const MAX_PEOPLE = 20;

export const accessSchema = z.enum(["open", "difficult", "sealed"]);
export const conditionSchema = z.enum(["good", "fair", "poor", "collapsing"]);

export const conditionsSchema = z.object({
  access: accessSchema.optional(),
  securitySeen: z.boolean().optional(),
  condition: conditionSchema.optional(),
  hazards: z.array(z.string().trim().min(1).max(HAZARD_MAX)).max(MAX_PEOPLE).optional(),
});
export type ConditionsInput = z.input<typeof conditionsSchema>;

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "DATE_FORMAT")
  .refine((day) => {
    const d = new Date(`${day}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
  }, "DATE_INVALID");

/** Exactly one of `userId` or a free `name`. */
export const visitPersonSchema = z.union([
  z.object({ userId: idSchema }),
  z.object({ name: z.string().trim().min(1).max(80) }),
]);
export type VisitPersonInput = z.input<typeof visitPersonSchema>;

const journal = z.string().max(JOURNAL_MAX).default("");
const people = z.array(visitPersonSchema).max(MAX_PEOPLE).default([]);

export const createVisitInput = z.object({
  locationId: idSchema,
  /** Defaults to today in the location's time zone. */
  visitedOn: isoDay.optional(),
  conditions: conditionsSchema.default({}),
  journalMd: journal,
  people,
  /** The trip this visit was part of; it must be visible to the author. */
  tripId: idSchema.nullable().optional(),
});
export type CreateVisitInput = z.input<typeof createVisitInput>;

export const updateVisitInput = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  visitedOn: isoDay.optional(),
  conditions: conditionsSchema.optional(),
  journalMd: z.string().max(JOURNAL_MAX).optional(),
  people: z.array(visitPersonSchema).max(MAX_PEOPLE).optional(),
  tripId: idSchema.nullable().optional(),
});
export type UpdateVisitInput = z.input<typeof updateVisitInput>;

export const visitIdInput = z.object({ id: idSchema });

export const listVisitsInput = z.object({ locationId: idSchema });

export const feedInput = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  authorId: idSchema.optional(),
  year: z.number().int().min(1900).max(2200).optional(),
});
export type FeedInput = z.input<typeof feedInput>;

export const yearInput = z.object({ year: z.number().int().min(1900).max(2200) });

export const previewMarkdownInput = z.object({ md: z.string().max(JOURNAL_MAX) });
