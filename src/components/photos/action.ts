import { showToast } from "~/components/ui/toast";
import { goToLogin, isSignedOutError } from "~/lib/error-text";
import { photoErrorText } from "~/lib/photos/errors";

/** Like runAction, with photo-specific German error texts. */
export async function runPhotoAction<T>(
  fn: () => Promise<T>,
  success?: string,
): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) showToast({ title: success, variant: "success" });
    return r;
  } catch (err) {
    if (isSignedOutError(err)) {
      goToLogin();
      return undefined;
    }
    showToast({ title: photoErrorText(err), variant: "error" });
    return undefined;
  }
}
