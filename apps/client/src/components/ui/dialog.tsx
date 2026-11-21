import * as DialogPrimitive from "@kobalte/core/dialog";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { m } from "@trespass/shared/paraglide/messages";
import { type ComponentProps, type JSX, splitProps, type ValidComponent } from "solid-js";
import { IconX } from "~/components/ui/icons";
import { cn } from "~/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogCloseButton = DialogPrimitive.CloseButton;

type ContentProps<T extends ValidComponent = "div"> = DialogPrimitive.DialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
};

/** Bottom sheet on phones, centered dialog from `sm` up. */
export function DialogContent<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, others] = splitProps(props as ContentProps, ["class", "children"]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="tr-animate-fade fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
      <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <DialogPrimitive.Content
          class={cn(
            "tr-animate-zoom relative grid max-h-[90dvh] w-full gap-4 overflow-y-auto rounded-t-xl border bg-popover p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50 before:absolute before:left-1/2 before:top-2 before:h-1 before:w-10 before:-translate-x-1/2 before:rounded-full before:bg-border sm:max-w-lg sm:rounded-xl sm:pb-5 sm:before:hidden",
            local.class,
          )}
          {...others}
        >
          {local.children}
          <DialogPrimitive.CloseButton
            class="absolute right-3 top-3 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={m.common_close()}
          >
            <IconX class="size-4" aria-hidden="true" />
          </DialogPrimitive.CloseButton>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col gap-1.5 pr-8", local.class)} {...others} />;
}

export function DialogFooter(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", local.class)}
      {...others}
    />
  );
}

type TitleProps<T extends ValidComponent = "h2"> = DialogPrimitive.DialogTitleProps<T> & {
  class?: string;
};
export function DialogTitle<T extends ValidComponent = "h2">(
  props: PolymorphicProps<T, TitleProps<T>>,
) {
  const [local, others] = splitProps(props as TitleProps, ["class"]);
  return <DialogPrimitive.Title class={cn("section-title text-xl", local.class)} {...others} />;
}

type DescriptionProps<T extends ValidComponent = "p"> =
  DialogPrimitive.DialogDescriptionProps<T> & { class?: string };
export function DialogDescription<T extends ValidComponent = "p">(
  props: PolymorphicProps<T, DescriptionProps<T>>,
) {
  const [local, others] = splitProps(props as DescriptionProps, ["class"]);
  return (
    <DialogPrimitive.Description
      class={cn("text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
}
