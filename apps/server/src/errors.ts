// Domain errors of the v1.1 services (history, comments, equipment, trips).
// The message is "CODE" or "CODE:detail"; shared/error-text.ts maps the code to
// German. Invisible and missing records are always the same 404 code, never
// a 403 (DESIGN §3.4 rule 9).
import type { z } from "zod";
import { HttpError } from "./auth/context";

export class AppError extends HttpError {
  constructor(
    status: 403 | 404 | 409 | 422,
    public readonly code: string,
    public readonly detail?: string,
  ) {
    super(status, detail ? `${code}:${detail}` : code);
    this.name = "AppError";
  }
}

export const appNotFound = (code: string) => new AppError(404, code);
export const appForbidden = (code: string) => new AppError(403, code);
export const appConflict = () => new AppError(409, "VERSION_CONFLICT");
export const appInvalid = (code: string, detail?: string) => new AppError(422, code, detail);

/** Codes of the shared Zod helpers that only mean "invalid input". */
const GENERIC = new Set(["DATE_FORMAT", "DATE_INVALID"]);

/**
 * Parses service input. A custom issue whose message is an error code (e.g.
 * HISTORY_DATE_INVALID) becomes that code; anything else is INVALID_INPUT.
 */
export function parseAppInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const message = issue?.message ?? "invalid";
    if (/^[A-Z][A-Z_]+$/.test(message) && !GENERIC.has(message)) throw appInvalid(message);
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw appInvalid("INVALID_INPUT", `${where}${message}`);
  }
  return r.data;
}
