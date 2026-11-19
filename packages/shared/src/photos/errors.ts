// Maps photo error codes (HTTP `{ error }` and server-function messages) to
// German text. Unknown errors get the generic message.
import { m } from "../paraglide/messages";

const TEXT: Record<string, () => string> = {
  PHOTO_NOT_FOUND: m.photos_error_not_found,
  PHOTO_FORBIDDEN: m.photos_error_forbidden,
  PHOTO_TYPE_UNSUPPORTED: m.photos_error_type,
  PHOTO_TOO_LARGE: m.photos_error_too_large,
  PHOTO_EMPTY: m.photos_error_empty,
  PHOTO_IMAGE_INVALID: m.photos_error_image_invalid,
  PHOTO_BAD_REQUEST: m.photos_error_bad_request,
  PHOTO_ORDER_INVALID: m.photos_error_order,
  PHOTO_ASSIGN_INVALID: m.photos_error_assign,
  NOT_AUTHENTICATED: m.auth_error_not_found,
  NETWORK: m.photos_error_network,
  SERVER: m.error_generic,
};

export const photoErrorCode = (err: unknown): string | undefined =>
  err instanceof Error ? err.message : typeof err === "string" ? err : undefined;

export function photoErrorText(err: unknown): string {
  const code = photoErrorCode(err);
  return (code && TEXT[code]?.()) || m.error_generic();
}
