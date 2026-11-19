// Zod inputs for trips, stops, people and the packing list (DESIGN §5.5).
import { z } from "zod";
import { idSchema } from "../locations/inputs";
import { isoDay } from "../visits/inputs";

export const TRIP_STATUSES = ["planned", "active", "done", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const MAX_STOPS = 50;
export const MAX_TRIP_PEOPLE = 20;
export const TRIP_TEXT_MAX = 20_000;

export const tripPersonSchema = z.union([
  z.object({ userId: idSchema }),
  z.object({ name: z.string().trim().min(1).max(80) }),
]);
export type TripPersonInput = z.input<typeof tripPersonSchema>;

/** An app user, or someone outside the app with an e-mail address or ntfy topic. */
export const emergencyContactSchema = z.union([
  z.object({ userId: idSchema }),
  z
    .object({
      name: z.string().trim().min(1).max(80),
      email: z.email().max(254).nullable().optional(),
      ntfyTopic: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{1,64}$/, "NTFY_TOPIC_INVALID")
        .nullable()
        .optional(),
    })
    .refine((c) => Boolean(c.email || c.ntfyTopic), "EMERGENCY_CONTACT_INVALID"),
]);
export type EmergencyContactInput = z.input<typeof emergencyContactSchema>;

const title = z.string().trim().min(1).max(160);
const text = z.string().max(TRIP_TEXT_MAX);
const day = isoDay.nullable().optional();

const datesOk = (v: { startsOn?: string | null; endsOn?: string | null }) =>
  !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;

export const createTripInput = z
  .object({
    title,
    startsOn: day,
    endsOn: day,
    notes: text.default(""),
    people: z.array(tripPersonSchema).max(MAX_TRIP_PEOPLE).default([]),
    emergencyContact: emergencyContactSchema.nullable().optional(),
    locationIds: z.array(idSchema).max(MAX_STOPS).default([]),
  })
  .refine(datesOk, { path: ["endsOn"], message: "TRIP_DATES_INVALID" });
export type CreateTripInput = z.input<typeof createTripInput>;

export const updateTripInput = z
  .object({
    id: idSchema,
    version: z.number().int().min(1),
    title: title.optional(),
    startsOn: day,
    endsOn: day,
    notes: text.optional(),
    reportMd: text.optional(),
    status: z.enum(TRIP_STATUSES).optional(),
    people: z.array(tripPersonSchema).max(MAX_TRIP_PEOPLE).optional(),
    emergencyContact: emergencyContactSchema.nullable().optional(),
  })
  .refine(datesOk, { path: ["endsOn"], message: "TRIP_DATES_INVALID" });
export type UpdateTripInput = z.input<typeof updateTripInput>;

export const tripIdInput = z.object({ id: idSchema });

/** The new order of the stops the caller can see; hidden stops keep their place at the end. */
export const setTripStopsInput = z.object({
  id: idSchema,
  locationIds: z.array(idSchema).max(MAX_STOPS),
});
export const tripStopInput = z.object({ tripId: idSchema, locationId: idSchema });

export const addChecklistItemInput = z.object({
  tripId: idSchema,
  label: z.string().trim().min(1).max(120),
});
export const addTemplateToTripInput = z.object({ tripId: idSchema, templateId: idSchema });
export const checklistItemInput = z.object({ id: idSchema });
export const setPackedInput = z.object({ id: idSchema, packed: z.boolean() });

export const listTripsInput = z.object({
  /** Only trips that are planned or active (the "Zur Tour hinzufügen" picker). */
  open: z.boolean().optional(),
});
