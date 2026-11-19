// Personal equipment and packing templates (DESIGN §5.5). Everything here is
// private to its owner: every query is scoped to ctx.userId in SQL, and a
// foreign or missing id is the same 404. Guests own no equipment (§3.5).
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import {
  type CreateEquipmentInput,
  type CreateTemplateInput,
  createEquipmentInput,
  createTemplateInput,
  type UpdateEquipmentInput,
  type UpdateTemplateInput,
  updateEquipmentInput,
  updateTemplateInput,
} from "@trespass/shared/equipment/inputs";
import type {
  EquipmentOverview,
  SerializedEquipment,
  SerializedTemplate,
} from "@trespass/shared/equipment/types";
import { m } from "@trespass/shared/paraglide/messages";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireCan } from "../authz/actions";
import type { AppDb, DbOrTx } from "../db/client";
import { type EquipmentRow, equipment, packTemplateItems, packTemplates } from "../db/schema";
import { appInvalid, appNotFound, parseAppInput } from "../errors";

const notFound = () => appNotFound("EQUIPMENT_NOT_FOUND");
const templateNotFound = () => appNotFound("TEMPLATE_NOT_FOUND");

export const serializeEquipment = (r: EquipmentRow): SerializedEquipment => ({
  id: r.id,
  name: r.name,
  category: r.category,
  weightG: r.weightG,
  needsCharging: r.needsCharging,
  notes: r.notes,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function ownEquipment(db: DbOrTx, ownerId: string): EquipmentRow[] {
  return db
    .select()
    .from(equipment)
    .where(eq(equipment.ownerId, ownerId))
    .orderBy(asc(equipment.category), asc(equipment.name))
    .all();
}

/** The caller's own equipment rows among `ids`; any foreign or unknown id is a 422. */
export function requireOwnEquipment(db: DbOrTx, ownerId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.ownerId, ownerId), inArray(equipment.id, unique)))
    .all();
  if (rows.length !== unique.length) throw appInvalid("EQUIPMENT_NOT_FOUND");
  return rows;
}

function templatesOf(db: DbOrTx, ownerId: string, weights: Map<string, number | null>) {
  const rows = db
    .select()
    .from(packTemplates)
    .where(eq(packTemplates.ownerId, ownerId))
    .orderBy(asc(packTemplates.name))
    .all();
  const items = rows.length
    ? db
        .select()
        .from(packTemplateItems)
        .where(
          inArray(
            packTemplateItems.templateId,
            rows.map((r) => r.id),
          ),
        )
        .all()
    : [];
  return rows.map((t): SerializedTemplate => {
    const ids = items.filter((i) => i.templateId === t.id).map((i) => i.equipmentId);
    return {
      id: t.id,
      name: t.name,
      equipmentIds: ids,
      weightG: ids.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0),
    };
  });
}

export function getEquipmentOverview(db: AppDb, ctx: AuthCtx): EquipmentOverview {
  requireCan(ctx, "ownEquipment");
  const rows = ownEquipment(db, ctx.userId);
  const weights = new Map(rows.map((r) => [r.id, r.weightG]));
  return {
    equipment: rows.map(serializeEquipment),
    templates: templatesOf(db, ctx.userId, weights),
  };
}

function requireItem(db: DbOrTx, ctx: AuthCtx, id: string): EquipmentRow {
  const row = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, id), eq(equipment.ownerId, ctx.userId)))
    .get();
  if (!row) throw notFound();
  return row;
}

export function createEquipment(
  db: AppDb,
  ctx: AuthCtx,
  raw: CreateEquipmentInput,
): SerializedEquipment {
  requireCan(ctx, "ownEquipment");
  const input = parseAppInput(createEquipmentInput, raw);
  const row = db
    .insert(equipment)
    .values({
      ownerId: ctx.userId,
      name: input.name,
      category: input.category,
      weightG: input.weightG ?? null,
      needsCharging: input.needsCharging,
      notes: input.notes || null,
    })
    .returning()
    .get();
  return serializeEquipment(row);
}

export function updateEquipment(
  db: AppDb,
  ctx: AuthCtx,
  raw: UpdateEquipmentInput,
): SerializedEquipment {
  requireCan(ctx, "ownEquipment");
  const input = parseAppInput(updateEquipmentInput, raw);
  return db.transaction((tx) => {
    const row = requireItem(tx, ctx, input.id);
    const set: Partial<typeof equipment.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.category !== undefined) set.category = input.category;
    if (input.weightG !== undefined) set.weightG = input.weightG;
    if (input.needsCharging !== undefined) set.needsCharging = input.needsCharging;
    if (input.notes !== undefined) set.notes = input.notes || null;
    const updated = tx.update(equipment).set(set).where(eq(equipment.id, row.id)).returning().get();
    return serializeEquipment(updated);
  });
}

/** Template items go with it (FK cascade); trip checklist lines keep their label. */
export function deleteEquipment(db: AppDb, ctx: AuthCtx, id: string): void {
  requireCan(ctx, "ownEquipment");
  db.transaction((tx) => {
    const row = requireItem(tx, ctx, id);
    tx.delete(equipment).where(eq(equipment.id, row.id)).run();
  });
}

// --- Templates ----------------------------------------------------------------------

export function requireTemplate(db: DbOrTx, ctx: AuthCtx, id: string) {
  const row = db
    .select()
    .from(packTemplates)
    .where(and(eq(packTemplates.id, id), eq(packTemplates.ownerId, ctx.userId)))
    .get();
  if (!row) throw templateNotFound();
  return row;
}

function setItems(db: DbOrTx, ctx: AuthCtx, templateId: string, ids: readonly string[]) {
  const rows = requireOwnEquipment(db, ctx.userId, ids);
  db.delete(packTemplateItems).where(eq(packTemplateItems.templateId, templateId)).run();
  if (rows.length)
    db.insert(packTemplateItems)
      .values(rows.map((r) => ({ templateId, equipmentId: r.id })))
      .run();
}

export function createTemplate(db: AppDb, ctx: AuthCtx, raw: CreateTemplateInput): { id: string } {
  requireCan(ctx, "ownEquipment");
  const input = parseAppInput(createTemplateInput, raw);
  return db.transaction((tx) => {
    const row = tx
      .insert(packTemplates)
      .values({ ownerId: ctx.userId, name: input.name })
      .returning({ id: packTemplates.id })
      .get();
    setItems(tx, ctx, row.id, input.equipmentIds);
    return { id: row.id };
  });
}

export function updateTemplate(db: AppDb, ctx: AuthCtx, raw: UpdateTemplateInput): { id: string } {
  requireCan(ctx, "ownEquipment");
  const input = parseAppInput(updateTemplateInput, raw);
  return db.transaction((tx) => {
    const row = requireTemplate(tx, ctx, input.id);
    if (input.name !== undefined)
      tx.update(packTemplates).set({ name: input.name }).where(eq(packTemplates.id, row.id)).run();
    if (input.equipmentIds !== undefined) setItems(tx, ctx, row.id, input.equipmentIds);
    return { id: row.id };
  });
}

export function deleteTemplate(db: AppDb, ctx: AuthCtx, id: string): void {
  requireCan(ctx, "ownEquipment");
  db.transaction((tx) => {
    const row = requireTemplate(tx, ctx, id);
    tx.delete(packTemplates).where(eq(packTemplates.id, row.id)).run();
  });
}

/** The four suggested templates (DESIGN §5.5), created once and only when none exist. */
export function createDefaultTemplates(db: AppDb, ctx: AuthCtx): { created: number } {
  requireCan(ctx, "ownEquipment");
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: packTemplates.id })
      .from(packTemplates)
      .where(eq(packTemplates.ownerId, ctx.userId))
      .get();
    if (existing) return { created: 0 };
    const names = [
      m.equipment_template_day(),
      m.equipment_template_night(),
      m.equipment_template_underground(),
      m.equipment_template_multiday(),
    ];
    tx.insert(packTemplates)
      .values(names.map((name) => ({ ownerId: ctx.userId, name })))
      .run();
    return { created: names.length };
  });
}

/** Own equipment and templates, for the export. */
export function equipmentForExport(db: AppDb, ownerIds: "all" | string) {
  const rows =
    ownerIds === "all"
      ? db.select().from(equipment).orderBy(asc(equipment.id)).all()
      : db
          .select()
          .from(equipment)
          .where(eq(equipment.ownerId, ownerIds))
          .orderBy(asc(equipment.id))
          .all();
  const templates =
    ownerIds === "all"
      ? db.select().from(packTemplates).orderBy(asc(packTemplates.id)).all()
      : db
          .select()
          .from(packTemplates)
          .where(eq(packTemplates.ownerId, ownerIds))
          .orderBy(asc(packTemplates.id))
          .all();
  const items = templates.length
    ? db
        .select()
        .from(packTemplateItems)
        .where(
          inArray(
            packTemplateItems.templateId,
            templates.map((t) => t.id),
          ),
        )
        .all()
    : [];
  return {
    equipment: rows.map((r) => ({ ownerId: r.ownerId, ...serializeEquipment(r) })),
    templates: templates.map((t) => ({
      id: t.id,
      ownerId: t.ownerId,
      name: t.name,
      equipmentIds: items.filter((i) => i.templateId === t.id).map((i) => i.equipmentId),
    })),
  };
}
