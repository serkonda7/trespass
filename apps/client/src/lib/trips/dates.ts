import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { TripSummary } from "@trespass/shared/trips/types";

/** "1. Dez. 2026 – 2. Dez. 2026", one day, or "ohne Datum". */
export function tripDates(t: Pick<TripSummary, "startsOn" | "endsOn">): string {
  if (!t.startsOn) return m.trips_no_date();
  if (!t.endsOn || t.endsOn === t.startsOn) return formatIsoDay(t.startsOn);
  return `${formatIsoDay(t.startsOn)} – ${formatIsoDay(t.endsOn)}`;
}
