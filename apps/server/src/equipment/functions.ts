// Server functions for equipment and packing templates (own data only).
import { createServerFn } from "@tanstack/solid-start";
import {
  createEquipmentInput,
  createTemplateInput,
  equipmentIdInput,
  templateIdInput,
  updateEquipmentInput,
  updateTemplateInput,
} from "@trespass/shared/equipment/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import {
  createDefaultTemplates,
  createEquipment,
  createTemplate,
  deleteEquipment,
  deleteTemplate,
  getEquipmentOverview,
  updateEquipment,
  updateTemplate,
} from "./service";

export const getEquipmentFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context: { ctx } }) => getEquipmentOverview(getDb(), ctx));

export const createEquipmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createEquipmentInput)
  .handler(({ context: { ctx }, data }) => createEquipment(getDb(), ctx, data));

export const updateEquipmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateEquipmentInput)
  .handler(({ context: { ctx }, data }) => updateEquipment(getDb(), ctx, data));

export const deleteEquipmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(equipmentIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteEquipment(getDb(), ctx, data.id);
    return { ok: true as const };
  });

export const createTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createTemplateInput)
  .handler(({ context: { ctx }, data }) => createTemplate(getDb(), ctx, data));

export const updateTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateTemplateInput)
  .handler(({ context: { ctx }, data }) => updateTemplate(getDb(), ctx, data));

export const deleteTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(templateIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteTemplate(getDb(), ctx, data.id);
    return { ok: true as const };
  });

export const createDefaultTemplatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(({ context: { ctx } }) => createDefaultTemplates(getDb(), ctx));
