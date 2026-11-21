// Maps error codes thrown by server functions (HttpError / UserInputError
// messages such as "LAST_ADMIN") to German text. Unknown errors get the
// generic message, so internals never reach the UI.
import { m } from "./paraglide/messages";

const TEXT: Record<string, () => string> = {
  USERNAME_INVALID: m.auth_error_username_invalid,
  USERNAME_TAKEN: m.auth_error_username_taken,
  PASSWORD_TOO_SHORT: m.auth_error_password_too_short,
  PASSWORD_TOO_LONG: m.auth_error_password_too_long,
  DISPLAY_NAME_REQUIRED: m.auth_error_display_name,
  RATE_LIMITED: m.auth_error_rate_limited,
  INVITE_INVALID: m.invite_invalid,
  NOT_FOUND: m.auth_error_not_found,
  LAST_ADMIN: m.admin_users_error_last_admin,
  SELF_DISABLE: m.admin_users_error_self_disable,
  GROUP_NAME_TAKEN: m.admin_groups_error_name_taken,
  GROUP_NAME_INVALID: m.admin_groups_error_name_invalid,
  SETTINGS_NAME_INVALID: m.admin_settings_error_name,
  SETTINGS_BUDGET_INVALID: m.admin_settings_error_budget,
  SETTINGS_TILE_BUDGET_INVALID: m.admin_settings_error_tile_budget,
  VISIT_NOT_FOUND: m.visits_error_not_found,
  VISIT_FORBIDDEN: m.visits_error_forbidden,
  VISIT_DATE_INVALID: m.visits_error_date,
  VISIT_PERSON_INVALID: m.visits_error_person,
  PHOTO_NOT_FOUND: m.photos_error_not_found,
  PHOTO_FORBIDDEN: m.photos_error_forbidden,
  PHOTO_TYPE_UNSUPPORTED: m.photos_error_type,
  PHOTO_TOO_LARGE: m.photos_error_too_large,
  PHOTO_EMPTY: m.photos_error_empty,
  PHOTO_IMAGE_INVALID: m.photos_error_image_invalid,
  PHOTO_BAD_REQUEST: m.photos_error_bad_request,
  PHOTO_ORDER_INVALID: m.photos_error_order,
  PHOTO_ASSIGN_INVALID: m.photos_error_assign,
  HISTORY_NOT_FOUND: m.history_error_not_found,
  HISTORY_FORBIDDEN: m.error_forbidden,
  HISTORY_DATE_INVALID: m.history_error_date,
  SOURCE_URL_INVALID: m.history_error_url,
  COMMENT_NOT_FOUND: m.comments_error_not_found,
  COMMENT_FORBIDDEN: m.error_forbidden,
  COMMENT_PARENT_INVALID: m.comments_error_parent,
  EQUIPMENT_NOT_FOUND: m.equipment_error_not_found,
  TEMPLATE_NOT_FOUND: m.equipment_error_template_not_found,
  TRIP_NOT_FOUND: m.trips_error_not_found,
  TRIP_FORBIDDEN: m.error_forbidden,
  TRIP_DATES_INVALID: m.trips_error_dates,
  TRIP_PERSON_INVALID: m.trips_error_person,
  TRIP_STOP_INVALID: m.trips_error_stop,
  TRIP_STOPS_FULL: m.trips_error_stops_full,
  CHECKLIST_ITEM_NOT_FOUND: m.trips_error_checklist_item,
  EMERGENCY_CONTACT_INVALID: m.trips_error_emergency_contact,
  RESEARCH_FORBIDDEN: m.error_forbidden,
  AREA_NOT_FOUND: m.research_error_area_not_found,
  AREA_SHAPE_INVALID: m.research_error_area_shape,
  AREA_TOO_LARGE: m.research_error_area_too_large,
  CANDIDATE_NOT_FOUND: m.research_error_candidate_not_found,
  CANDIDATE_DECIDED: m.research_error_candidate_decided,
  CANDIDATE_DECISION_INVALID: m.research_error_decision,
  LOCATION_NOT_FOUND: m.locations_error_not_found,
  LOCATION_FORBIDDEN: m.error_forbidden,
  Forbidden: m.error_forbidden,
  // Shared with the location forms.
  VERSION_CONFLICT: m.locations_error_version_conflict,
  INVALID_INPUT: m.locations_error_invalid_input,
  CURSOR_INVALID: m.locations_error_cursor,
};

export function errorCode(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export function errorText(err: unknown): string {
  const code = errorCode(err);
  if (!code) return m.error_generic();
  // Domain errors are "CODE" or "CODE:detail"; the detail is never shown.
  const head = code.includes(":") ? code.slice(0, code.indexOf(":")) : code;
  return TEXT[code]?.() || TEXT[head]?.() || m.error_generic();
}

/** Server functions throw this message when the session is gone (see auth/session.ts). */
export const isSignedOutError = (err: unknown) => errorCode(err) === "Not authenticated";

/** Full reload to /login, keeping the current page as the redirect target. */
export function goToLogin() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?redirect=${encodeURIComponent(here)}`);
}
