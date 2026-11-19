// Zod inputs for personal equipment and packing templates (DESIGN §5.5).
import { z } from "zod";
import { idSchema } from "../locations/inputs";

export const EQUIPMENT_CATEGORIES = [
  "light",
  "protection",
  "photo",
  "navigation",
  "first_aid",
  "tools",
  "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export const MAX_TEMPLATE_ITEMS = 200;

const name = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(2000).nullable().optional();
const weight = z.number().int().min(0).max(1_000_000).nullable().optional();

export const createEquipmentInput = z.object({
  name,
  category: z.enum(EQUIPMENT_CATEGORIES).default("other"),
  weightG: weight,
  needsCharging: z.boolean().default(false),
  notes,
});
export type CreateEquipmentInput = z.input<typeof createEquipmentInput>;

export const updateEquipmentInput = z.object({
  id: idSchema,
  name: name.optional(),
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  weightG: weight,
  needsCharging: z.boolean().optional(),
  notes,
});
export type UpdateEquipmentInput = z.input<typeof updateEquipmentInput>;

export const equipmentIdInput = z.object({ id: idSchema });

export const createTemplateInput = z.object({
  name,
  equipmentIds: z.array(idSchema).max(MAX_TEMPLATE_ITEMS).default([]),
});
export type CreateTemplateInput = z.input<typeof createTemplateInput>;

export const updateTemplateInput = z.object({
  id: idSchema,
  name: name.optional(),
  equipmentIds: z.array(idSchema).max(MAX_TEMPLATE_ITEMS).optional(),
});
export type UpdateTemplateInput = z.input<typeof updateTemplateInput>;

export const templateIdInput = z.object({ id: idSchema });
