// Offline coordinate -> IANA time zone lookup (DESIGN §5.7). The bundled
// boundary table never makes a network request. Falls back to Etc/UTC for
// points outside any zone (oceans) or on lookup errors.
import tzlookup from "@photostructure/tz-lookup";
import type { Point } from "../../lib/geo/types";

export function timeZoneForPoint(point: Point): string {
  try {
    return tzlookup(point.lat, point.lon) || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}
