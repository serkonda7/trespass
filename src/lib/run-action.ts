import { showToast } from "~/components/ui/toast";
import { errorText, goToLogin, isSignedOutError } from "./error-text";

/** German text for any error a server function can throw (codes in error-text.ts). */
export function actionErrorText(err: unknown): string {
  return errorText(err);
}

/**
 * Runs a UI action (usually a server function call): toasts `success` when it
 * works, the mapped error text when it fails, and sends signed-out users
 * (e.g. just disabled) to /login. Returns the result, or undefined on error.
 * `onError` sees the raw error first; return true from it to skip the toast.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
  opts: {
    success?: string | ((r: T) => string);
    onError?: (err: unknown) => boolean | undefined;
  } = {},
): Promise<T | undefined> {
  try {
    const r = await fn();
    const s = typeof opts.success === "function" ? opts.success(r) : opts.success;
    if (s) showToast({ title: s, variant: "success" });
    return r;
  } catch (err) {
    if (isSignedOutError(err)) {
      goToLogin();
      return undefined;
    }
    if (opts.onError?.(err) === true) return undefined;
    showToast({ title: actionErrorText(err), variant: "error" });
    return undefined;
  }
}
