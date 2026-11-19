import { goToLogin, isSignedOutError } from "@trespass/shared/error-text";
import { photoErrorText } from "@trespass/shared/photos/errors";
import { showToast } from "~/components/ui/toast";

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
