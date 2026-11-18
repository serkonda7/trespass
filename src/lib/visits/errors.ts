// Error codes of the visit server functions and their German text. The server
// throws VisitsError with message "CODE" or "CODE:detail".
import { m } from "~/paraglide/messages";
import { errorText } from "../error-text";

export const VISITS_ERROR_CODES = [
  "VISIT_NOT_FOUND",
  "VISIT_FORBIDDEN",
  "VISIT_DATE_INVALID",
  "VISIT_PERSON_INVALID",
  "VERSION_CONFLICT",
  "INVALID_INPUT",
  "CURSOR_INVALID",
] as const;
export type VisitsErrorCode = (typeof VISITS_ERROR_CODES)[number];

export type ParsedVisitsError = { code: VisitsErrorCode | null; detail: string };

export function parseVisitsError(err: unknown): ParsedVisitsError {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const i = raw.indexOf(":");
  const head = i === -1 ? raw : raw.slice(0, i);
  const code = (VISITS_ERROR_CODES as readonly string[]).includes(head)
    ? (head as VisitsErrorCode)
    : null;
  return { code, detail: i === -1 ? "" : raw.slice(i + 1) };
}

export function visitsErrorText(err: unknown): string {
  const { code } = parseVisitsError(err);
  switch (code) {
    case "VISIT_NOT_FOUND":
      return m.visits_error_not_found();
    case "VISIT_FORBIDDEN":
      return m.visits_error_forbidden();
    case "VISIT_DATE_INVALID":
      return m.visits_error_date();
    case "VISIT_PERSON_INVALID":
      return m.visits_error_person();
    case "VERSION_CONFLICT":
      return m.locations_error_version_conflict();
    case "INVALID_INPUT":
      return m.locations_error_invalid_input();
    case "CURSOR_INVALID":
      return m.locations_error_cursor();
    default:
      return errorText(err);
  }
}
