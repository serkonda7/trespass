import { beforeEach, expect, test } from "bun:test";
import { failure } from "../authz/test-errors";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { createTestDb } from "../db/test-db";
import {
  createDefaultTemplates,
  createEquipment,
  createTemplate,
  deleteEquipment,
  getEquipmentOverview,
  updateEquipment,
  updateTemplate,
} from "./service";

const anna = ctxFor("anna", "member");
const ben = ctxFor("ben", "member");
const guest = ctxFor("guest", "guest");
let db: AppDb;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: "anna", role: "member" },
      { id: "ben", role: "member" },
      { id: "guest", role: "guest" },
    ],
  });
});

test("equipment and templates are private to their owner", () => {
  const lamp = createEquipment(db, anna, { name: "Stirnlampe", category: "light", weightG: 90 });
  const mask = createEquipment(db, anna, {
    name: "FFP3-Maske",
    category: "protection",
    weightG: 20,
  });
  const { id } = createTemplate(db, anna, { name: "Tagestour", equipmentIds: [lamp.id, mask.id] });
  expect(getEquipmentOverview(db, anna).templates).toEqual([
    {
      id,
      name: "Tagestour",
      equipmentIds: expect.arrayContaining([lamp.id, mask.id]),
      weightG: 110,
    },
  ]);
  expect(getEquipmentOverview(db, ben)).toEqual({ equipment: [], templates: [] });
  expect(failure(() => updateEquipment(db, ben, { id: lamp.id, name: "meins" }))).toEqual({
    status: 404,
    code: "EQUIPMENT_NOT_FOUND",
  });
  expect(failure(() => createTemplate(db, ben, { name: "x", equipmentIds: [lamp.id] }))).toEqual({
    status: 422,
    code: "EQUIPMENT_NOT_FOUND",
  });
  expect(failure(() => updateTemplate(db, ben, { id, name: "x" }))?.code).toBe(
    "TEMPLATE_NOT_FOUND",
  );
  expect(failure(() => getEquipmentOverview(db, guest))?.status).toBe(403);
});

test("deleting equipment removes it from templates", () => {
  const lamp = createEquipment(db, anna, { name: "Lampe" });
  createTemplate(db, anna, { name: "T", equipmentIds: [lamp.id] });
  deleteEquipment(db, anna, lamp.id);
  expect(getEquipmentOverview(db, anna).templates[0]!.equipmentIds).toEqual([]);
});

test("default templates are created once", () => {
  expect(createDefaultTemplates(db, anna)).toEqual({ created: 4 });
  expect(createDefaultTemplates(db, anna)).toEqual({ created: 0 });
  expect(getEquipmentOverview(db, anna).templates.map((t) => t.name)).toContain("Nachtfoto");
});
