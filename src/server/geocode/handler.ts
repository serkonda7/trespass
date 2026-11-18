// The `geocode.reverse` job handler. Idempotent: it fills only fields that are
// still NULL and does nothing when the location is gone or already complete.
import { eq } from "drizzle-orm";
import { locations } from "../db/schema";
import type { JobContext } from "../jobs/worker";
import { geocodeEnabled, reverseGeocode } from "./reverse";

export type ReverseGeocodePayload = { locationId: string; lat: number; lon: number };

export function isReverseGeocodePayload(value: unknown): value is ReverseGeocodePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.locationId === "string" &&
    typeof p.lat === "number" &&
    Number.isFinite(p.lat) &&
    typeof p.lon === "number" &&
    Number.isFinite(p.lon)
  );
}

export async function handleReverseGeocode(payload: unknown, ctx: JobContext): Promise<void> {
  if (!geocodeEnabled() || !isReverseGeocodePayload(payload)) return;
  const current = ctx.db
    .select({ country: locations.country, adminArea: locations.adminArea })
    .from(locations)
    .where(eq(locations.id, payload.locationId))
    .get();
  if (!current || (current.country && current.adminArea)) return;

  const result = await reverseGeocode(
    { lat: payload.lat, lon: payload.lon },
    { signal: ctx.signal },
  );
  if (ctx.signal.aborted) return;
  ctx.db.transaction((tx) => {
    const fresh = tx
      .select({ country: locations.country, adminArea: locations.adminArea })
      .from(locations)
      .where(eq(locations.id, payload.locationId))
      .get();
    if (!fresh) return;
    tx.update(locations)
      .set({
        country: fresh.country ?? result.country,
        adminArea: fresh.adminArea ?? result.adminArea,
      })
      .where(eq(locations.id, payload.locationId))
      .run();
  });
}
