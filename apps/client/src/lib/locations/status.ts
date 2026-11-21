// Status labels and pin colours (DESIGN §2, §5.1). The German text lives in
// the Paraglide catalog; the colours are the single map used by pins, lists and
// badges so a status always looks the same everywhere.

import type { LocationStatus, StoredLocationStatus } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";

/** Every status, including derived `visited` (for badges, colours and filters). */
export const STATUSES: readonly LocationStatus[] = [
  "idea",
  "researched",
  "planned",
  "visited",
  "sealed",
  "redeveloped",
  "demolished",
];

/** Statuses the create/edit form may set; `visited` is derived from visits. */
export const EDITABLE_STATUSES: readonly StoredLocationStatus[] = STATUSES.filter(
  (s): s is StoredLocationStatus => s !== "visited",
);

const LABELS: Record<LocationStatus, () => string> = {
  idea: m.location_status_idea,
  researched: m.location_status_researched,
  planned: m.location_status_planned,
  visited: m.location_status_visited,
  sealed: m.location_status_sealed,
  redeveloped: m.location_status_redeveloped,
  demolished: m.location_status_demolished,
};

// Dark-map friendly fills, distinguishable from each other and from the
// orange app accent; all reach WCAG AA against the dark surfaces.
const COLORS: Record<LocationStatus, string> = {
  idea: "#b7a8ef",
  researched: "#6cb8e0",
  planned: "#f0c449",
  visited: "#6fcf8e",
  sealed: "#ec8fb0",
  redeveloped: "#a3adb8",
  demolished: "#f0675a",
};

const LEVEL_LABELS = {
  view: m.levels_view,
  contribute: m.levels_contribute,
  precise: m.levels_precise,
  edit: m.levels_edit,
  manage: m.levels_manage,
};

export const statusLabel = (status: LocationStatus): string => LABELS[status]();
export const statusColor = (status: LocationStatus): string => COLORS[status];

/** German label for a location permission level (sharing UI). */
export const levelLabel = (level: keyof typeof LEVEL_LABELS): string => LEVEL_LABELS[level]();
