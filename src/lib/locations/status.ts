// Status labels and pin colours (DESIGN §2, §5.1). The German text lives in
// the Paraglide catalog; the colours are the single map used by pins, lists and
// badges so a status always looks the same everywhere.
import { m } from "~/paraglide/messages";
import type { LocationStatus, StoredLocationStatus } from "./types";

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

// Dark-map friendly, WCAG-AA-distinguishable fills.
const COLORS: Record<LocationStatus, string> = {
  idea: "#a78bfa",
  researched: "#38bdf8",
  planned: "#fbbf24",
  visited: "#22d3ee",
  sealed: "#f97316",
  redeveloped: "#34d399",
  demolished: "#ef4444",
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
