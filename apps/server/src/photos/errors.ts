// Errors of the photo service and upload route. `code` is the message the UI
// maps to German (src/lib/photos/errors.ts); invisible photos are always 404.
import type { PhotoErrorCode } from "@trespass/shared/photos/rules";
import { HttpError } from "../auth/context";

export class PhotoError extends HttpError {
  constructor(
    status: 400 | 403 | 404 | 409 | 413 | 415 | 422,
    public readonly code: PhotoErrorCode,
  ) {
    super(status, code);
    this.name = "PhotoError";
  }
}

export const photoNotFound = () => new PhotoError(404, "PHOTO_NOT_FOUND");
export const photoForbidden = () => new PhotoError(403, "PHOTO_FORBIDDEN");
export const typeUnsupported = () => new PhotoError(415, "PHOTO_TYPE_UNSUPPORTED");
export const tooLarge = () => new PhotoError(413, "PHOTO_TOO_LARGE");

/** Maps PhotoError/HttpError to a JSON response for the API routes. */
export function photoErrorResponse(err: unknown): Response {
  if (err instanceof PhotoError) {
    const body: { error: PhotoErrorCode; message?: string } = { error: err.code };
    return Response.json(body, {
      status: err.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (err instanceof HttpError)
    return Response.json({ error: err.message }, { status: err.status });
  throw err;
}
