import { Toast, toaster } from "@kobalte/core/toast";
import { m } from "@trespass/shared/paraglide/messages";
import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { IconX } from "~/components/ui/icons";
import { cn } from "~/lib/cn";

/** Mount once (the root layout does). */
export function Toaster() {
  return (
    <Portal>
      <Toast.Region duration={5000} limit={3} swipeDirection="down">
        <Toast.List class="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-[100] mx-auto flex w-full max-w-md flex-col gap-2 p-4 outline-none" />
      </Toast.Region>
    </Portal>
  );
}

type ToastVariant = "default" | "success" | "error";

/** Show a toast: `showToast({ title: m.saved(), variant: "success" })`. */
export function showToast(opts: { title: string; description?: string; variant?: ToastVariant }) {
  return toaster.show((props) => (
    <Toast
      toastId={props.toastId}
      class={cn(
        "tr-animate-slide flex items-start justify-between gap-3 rounded-lg border border-l-4 border-l-border bg-popover p-4 shadow-2xl shadow-black/50",
        opts.variant === "error" && "border-l-destructive",
        opts.variant === "success" && "border-l-success",
      )}
    >
      <div class="grid gap-1">
        <Toast.Title class="text-sm font-semibold">{opts.title}</Toast.Title>
        <Show when={opts.description}>
          <Toast.Description class="text-sm opacity-90">{opts.description}</Toast.Description>
        </Show>
      </div>
      <Toast.CloseButton
        class="-m-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={m.common_close()}
      >
        <IconX class="size-4" aria-hidden="true" />
      </Toast.CloseButton>
    </Toast>
  ));
}
