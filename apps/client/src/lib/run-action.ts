import { errorText, goToLogin, isSignedOutError } from "@trespass/shared/error-text";
import { showToast } from "~/components/ui/toast";

/** German text for any error a server function can throw (codes in error-text.ts). */
export function actionErrorText(err: unknown): string {
  return errorText(err);
}

/**
 * Runs a UI action: toasts `success` or the mapped error, sends signed-out
 * users to /login. Returns the result or undefined. `onError` returning true
 * skips the toast.
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
