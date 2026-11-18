// German labels for the structured visit conditions (DESIGN §5.2).
import { m } from "~/paraglide/messages";
import type { VisitAccess, VisitCondition, VisitConditions } from "./types";

const ACCESS: Record<VisitAccess, () => string> = {
  open: m.visit_access_open,
  difficult: m.visit_access_difficult,
  sealed: m.visit_access_sealed,
};

const CONDITION: Record<VisitCondition, () => string> = {
  good: m.visit_condition_good,
  fair: m.visit_condition_fair,
  poor: m.visit_condition_poor,
  collapsing: m.visit_condition_collapsing,
};

export const accessLabel = (a: VisitAccess): string => ACCESS[a]();
export const conditionLabel = (c: VisitCondition): string => CONDITION[c]();

export const ACCESS_OPTIONS: readonly VisitAccess[] = ["open", "difficult", "sealed"];
export const CONDITION_OPTIONS: readonly VisitCondition[] = ["good", "fair", "poor", "collapsing"];

/** All badges of one visit, in a stable order. */
export function conditionBadges(conditions: VisitConditions): string[] {
  const out: string[] = [];
  if (conditions.access) out.push(accessLabel(conditions.access));
  if (conditions.condition) out.push(conditionLabel(conditions.condition));
  if (conditions.securitySeen) out.push(m.visits_security_seen());
  for (const hazard of conditions.hazards ?? []) out.push(hazard);
  return out;
}
