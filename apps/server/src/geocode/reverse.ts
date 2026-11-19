// Nominatim reverse geocoding (DESIGN §4). One request per second at most,
// generic User-Agent, no personal data. The fetch function, clock and throttle
// are injectable so tests never touch the network. GEOCODE=off disables the
// job via geocodeEnabled() (called before enqueue and in the handler).
import type { Point } from "@trespass/shared/geo/types";
import { getEnv } from "../env";

export type GeocodeFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export type ReverseResult = { country: string | null; adminArea: string | null };

export const USER_AGENT = "trespass/0.1";
export const NOMINATIM_HOST = "nominatim.openstreetmap.org";

export const geocodeEnabled = (): boolean => getEnv().GEOCODE === "on";

// Module-level throttle shared by every job in the process.
let nextAllowedAt = 0;

async function defaultThrottle(now: () => number): Promise<void> {
  const t = now();
  const wait = Math.max(0, nextAllowedAt - t);
  nextAllowedAt = Math.max(t, nextAllowedAt) + 1000;
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}

/** Resets the throttle (tests only). */
export function resetGeocodeThrottle(): void {
  nextAllowedAt = 0;
}

export function reverseGeocodeUrl(point: Point): string {
  const url = new URL(`https://${NOMINATIM_HOST}/reverse`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "10");
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lon", String(point.lon));
  return url.toString();
}

export type GeocodeDeps = {
  fetch?: GeocodeFetch;
  now?: () => number;
  /** Injectable in tests (a no-op) so the 1 req/s delay never slows a test. */
  throttle?: () => Promise<void>;
  signal?: AbortSignal;
};

export async function reverseGeocode(point: Point, deps: GeocodeDeps = {}): Promise<ReverseResult> {
  const doFetch = deps.fetch ?? (fetch as GeocodeFetch);
  if (deps.fetch === undefined)
    await (deps.throttle ?? (() => defaultThrottle(deps.now ?? Date.now)))();
  else if (deps.throttle) await deps.throttle();

  const response = await doFetch(reverseGeocodeUrl(point), {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "de" },
    signal: deps.signal,
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  const body = (await response.json()) as {
    address?: { country?: string; state?: string };
  };
  return {
    country: body.address?.country ?? null,
    adminArea: body.address?.state ?? null,
  };
}
