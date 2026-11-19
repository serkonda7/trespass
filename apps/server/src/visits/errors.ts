// Errors of the visit service. Their message is "CODE" or "CODE:detail"
// (codes and German text: src/lib/visits/errors.ts). An invisible or missing
// visit is always VISIT_NOT_FOUND (404), never forbidden (DESIGN §3.4 rule 9).

import type { VisitsErrorCode } from "@trespass/shared/visits/errors";
import type { z } from "zod";
import { HttpError } from "../auth/context";

export class VisitsError extends HttpError {
  constructor(
    status: 403 | 404 | 409 | 422,
    public readonly code: VisitsErrorCode,
    public readonly detail?: string,
  ) {
    super(status, detail ? `${code}:${detail}` : code);
    this.name = "VisitsError";
  }
}

export const visitNotFound = () => new VisitsError(404, "VISIT_NOT_FOUND");
export const visitForbidden = () => new VisitsError(403, "VISIT_FORBIDDEN");
export const conflict = () => new VisitsError(409, "VERSION_CONFLICT");
export const invalidDate = () => new VisitsError(422, "VISIT_DATE_INVALID");

/** Parses service input; a failure is INVALID_INPUT with the first issue as detail. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new VisitsError(422, "INVALID_INPUT", `${where}${issue?.message ?? "invalid"}`);
  }
  return r.data;
}
