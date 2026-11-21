// Error codes of the location server functions and their German text. The
// server throws LocationsError (src/server/locations/errors.ts) whose message
// is "CODE" or "CODE:detail"; that survives server-function serialization.

import { errorText } from "../error-text";
import { m } from "../paraglide/messages";

export const LOCATIONS_ERROR_CODES = [
  "LOCATION_NOT_FOUND",
  "LOCATION_FORBIDDEN",
  "VERSION_CONFLICT",
  "INVALID_INPUT",
  "CATEGORY_INVALID",
  "COORDS_INVALID",
  "FUZZ_INVALID",
  "GRANT_INVALID",
  "GRANT_ABOVE_CEILING",
  "PRINCIPAL_NOT_FOUND",
  "PRINCIPAL_DISABLED",
  "CURSOR_INVALID",
  "TAG_INVALID",
] as const;
export type LocationsErrorCode = (typeof LOCATIONS_ERROR_CODES)[number];

export type ParsedLocationsError = { code: LocationsErrorCode | null; detail: string };

export function parseLocationsError(err: unknown): ParsedLocationsError {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const i = raw.indexOf(":");
  const head = i === -1 ? raw : raw.slice(0, i);
  const code = (LOCATIONS_ERROR_CODES as readonly string[]).includes(head)
    ? (head as LocationsErrorCode)
    : null;
  return { code, detail: i === -1 ? "" : raw.slice(i + 1) };
}

export function locationsErrorText(err: unknown): string {
  const { code } = parseLocationsError(err);
  switch (code) {
    case "LOCATION_NOT_FOUND":
      return m.locations_error_not_found();
    case "LOCATION_FORBIDDEN":
      return m.locations_error_forbidden();
    case "VERSION_CONFLICT":
      return m.locations_error_version_conflict();
    case "INVALID_INPUT":
      return m.locations_error_invalid_input();
    case "CATEGORY_INVALID":
      return m.locations_error_category();
    case "COORDS_INVALID":
      return m.locations_error_coords();
    case "GRANT_INVALID":
      return m.locations_error_grant();
    case "GRANT_ABOVE_CEILING":
      return m.locations_error_grant_ceiling();
    case "PRINCIPAL_NOT_FOUND":
      return m.locations_error_principal_not_found();
    case "PRINCIPAL_DISABLED":
      return m.locations_error_principal_disabled();
    case "CURSOR_INVALID":
      return m.locations_error_cursor();
    case "TAG_INVALID":
      return m.locations_error_tag();
    default:
      return errorText(err);
  }
}
