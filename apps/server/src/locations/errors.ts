// Location service error; message "CODE" or "CODE:detail" (shared/locations/errors.ts).
// Invisible = missing: LOCATION_NOT_FOUND (404), never FORBIDDEN.

import type { LocationsErrorCode } from "@trespass/shared/locations/errors";
import type { z } from "zod";
import { HttpError } from "../auth/context";

export class LocationsError extends HttpError {
  constructor(
    status: 403 | 404 | 409 | 422,
    public readonly code: LocationsErrorCode,
    public readonly detail?: string,
  ) {
    super(status, detail ? `${code}:${detail}` : code);
    this.name = "LocationsError";
  }
}

export const notFound = () => new LocationsError(404, "LOCATION_NOT_FOUND");
export const forbidden = () => new LocationsError(403, "LOCATION_FORBIDDEN");
export const conflict = () => new LocationsError(409, "VERSION_CONFLICT");

/** Parses service input; a failure is INVALID_INPUT with the first issue as detail. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new LocationsError(422, "INVALID_INPUT", `${where}${issue?.message ?? "invalid"}`);
  }
  return r.data;
}
