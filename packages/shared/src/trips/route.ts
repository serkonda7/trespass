// Route preview (DESIGN §5.5): straight lines and distances between consecutive
// stops. Uses only the points the server already serialized for the caller, so
// a leg that touches a fuzzed point is marked approximate.
import { haversineMeters } from "../geo/distance";
import type { Point } from "../geo/types";

export type RouteStop = { point: Point; exact: boolean };
export type RouteLeg = { from: number; to: number; meters: number; approximate: boolean };

export function routeLegs(stops: readonly RouteStop[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    legs.push({
      from: i - 1,
      to: i,
      meters: haversineMeters(a.point, b.point),
      approximate: !a.exact || !b.exact,
    });
  }
  return legs;
}

export function routeTotal(legs: readonly RouteLeg[]): { meters: number; approximate: boolean } {
  return {
    meters: legs.reduce((sum, l) => sum + l.meters, 0),
    approximate: legs.some((l) => l.approximate),
  };
}

/** "850 m", "12,4 km", "128 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: km < 100 ? 1 : 0 }).format(km)} km`;
}
