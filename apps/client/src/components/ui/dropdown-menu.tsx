import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { type ComponentProps, splitProps, type ValidComponent } from "solid-js";
import { cn } from "~/lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

type ContentProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuContentProps<T> & { class?: string };
export function DropdownMenuContent<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, others] = splitProps(props as ContentProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          "tr-animate-fade z-50 min-w-48 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl shadow-black/40",
          local.class,
        )}
        {...others}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

type ItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuItemProps<T> & {
    class?: string;
  };
export function DropdownMenuItem<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ItemProps<T>>,
) {
  const [local, others] = splitProps(props as ItemProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base outline-none [&_svg]:size-4 [&_svg]:text-muted-foreground data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
}

export function DropdownMenuLabel(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("px-2.5 py-2 text-sm font-semibold", local.class)} {...others} />;
}

type SeparatorProps<T extends ValidComponent = "hr"> =
  DropdownMenuPrimitive.DropdownMenuSeparatorProps<T> & { class?: string };
export function DropdownMenuSeparator<T extends ValidComponent = "hr">(
  props: PolymorphicProps<T, SeparatorProps<T>>,
) {
  const [local, others] = splitProps(props as SeparatorProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Separator
      class={cn("-mx-1 my-1 h-px border-none bg-border", local.class)}
      {...others}
    />
  );
}
