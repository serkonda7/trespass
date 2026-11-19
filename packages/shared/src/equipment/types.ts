// Output shapes of the equipment server functions. No server-only imports.
import type { EquipmentCategory } from "./inputs";

export type SerializedEquipment = {
  id: string;
  name: string;
  category: EquipmentCategory;
  weightG: number | null;
  needsCharging: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SerializedTemplate = {
  id: string;
  name: string;
  equipmentIds: string[];
  /** Sum of the known item weights in grams. */
  weightG: number;
};

export type EquipmentOverview = {
  equipment: SerializedEquipment[];
  templates: SerializedTemplate[];
};
