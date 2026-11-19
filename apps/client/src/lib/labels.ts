// German labels for enum values. Keys stay English; text comes from the catalog.

import type { Role } from "@trespass/shared/authz/ctx";
import type { EquipmentCategory } from "@trespass/shared/equipment/inputs";
import type { HistoryPrecision } from "@trespass/shared/history/inputs";
import { m } from "@trespass/shared/paraglide/messages";
import type { TripStatus } from "@trespass/shared/trips/inputs";

export const roleLabel = (role: Role): string =>
  ({ admin: m.role_admin, member: m.role_member, guest: m.role_guest })[role]();

export const precisionLabel = (p: HistoryPrecision): string =>
  ({
    day: m.history_precision_day,
    month: m.history_precision_month,
    year: m.history_precision_year,
    decade: m.history_precision_decade,
    circa: m.history_precision_circa,
  })[p]();

export const equipmentCategoryLabel = (c: EquipmentCategory): string =>
  ({
    light: m.equipment_category_light,
    protection: m.equipment_category_protection,
    photo: m.equipment_category_photo,
    navigation: m.equipment_category_navigation,
    first_aid: m.equipment_category_first_aid,
    tools: m.equipment_category_tools,
    other: m.equipment_category_other,
  })[c]();

export const tripStatusLabel = (s: TripStatus): string =>
  ({
    planned: m.trips_status_planned,
    active: m.trips_status_active,
    done: m.trips_status_done,
    cancelled: m.trips_status_cancelled,
  })[s]();
