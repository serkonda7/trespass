// Maps error codes thrown by server functions (HttpError / UserInputError
// messages such as "LAST_ADMIN") to German text. Unknown errors get the
// generic message, so internals never reach the UI.
import { m } from "~/paraglide/messages";

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
  SETTINGS_FUZZ_INVALID: m.admin_settings_error_fuzz,
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
  return (code && TEXT[code]?.()) || m.error_generic();
}

/** Server functions throw this message when the session is gone (see auth/session.ts). */
export const isSignedOutError = (err: unknown) => errorCode(err) === "Not authenticated";

/** Full reload to /login, keeping the current page as the redirect target. */
export function goToLogin() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?redirect=${encodeURIComponent(here)}`);
}
