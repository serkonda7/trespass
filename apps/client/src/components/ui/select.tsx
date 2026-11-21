import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SelectPrimitive from "@kobalte/core/select";
import { type JSX, splitProps, type ValidComponent } from "solid-js";
import { IconCheck, IconChevronDown } from "~/components/ui/icons";
import { cn } from "~/lib/cn";

/**
 * Kobalte select parts with app styling. Usage:
 *   <Select options={["a","b"]} itemComponent={(p) => <SelectItem item={p.item}>{p.item.rawValue}</SelectItem>}>
 *     <SelectTrigger aria-label="…"><SelectValue<string>>{(s) => s.selectedOption()}</SelectValue></SelectTrigger>
 *     <SelectContent />
 *   </Select>
 */
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectHiddenSelect = SelectPrimitive.HiddenSelect;

/** Kobalte's own label: it wires `aria-labelledby` to the trigger (a plain `<label for>` cannot). */
export function SelectLabel(props: { class?: string; children?: JSX.Element }) {
  return (
    <SelectPrimitive.Label
      class={cn("text-sm font-semibold leading-none text-foreground/90", props.class)}
    >
      {props.children}
    </SelectPrimitive.Label>
  );
}

type TriggerProps<T extends ValidComponent = "button"> = SelectPrimitive.SelectTriggerProps<T> & {
  class?: string;
  children?: JSX.Element;
};

export function SelectTrigger<T extends ValidComponent = "button">(
  props: PolymorphicProps<T, TriggerProps<T>>,
) {
  const [local, others] = splitProps(props as TriggerProps, ["class", "children"]);
  return (
    <SelectPrimitive.Trigger
      class={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-input/70 bg-background px-3 py-1.5 text-sm pointer-coarse:h-11 pointer-coarse:py-2 pointer-coarse:text-base hover:border-input focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        local.class,
      )}
      {...others}
    >
      {local.children}
      <SelectPrimitive.Icon class="ml-2 opacity-60" aria-hidden="true">
        <IconChevronDown class="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

type ContentProps<T extends ValidComponent = "div"> = SelectPrimitive.SelectContentProps<T> & {
  class?: string;
};

export function SelectContent<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, others] = splitProps(props as ContentProps, ["class"]);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        class={cn(
          "tr-animate-fade relative z-50 min-w-32 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl shadow-black/40",
          local.class,
        )}
        {...others}
      >
        <SelectPrimitive.Listbox class="m-0 max-h-80 overflow-y-auto p-1" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

type ItemProps<T extends ValidComponent = "li"> = SelectPrimitive.SelectItemProps<T> & {
  class?: string;
  children?: JSX.Element;
};

export function SelectItem<T extends ValidComponent = "li">(
  props: PolymorphicProps<T, ItemProps<T>>,
) {
  const [local, others] = splitProps(props as ItemProps, ["class", "children"]);
  return (
    <SelectPrimitive.Item
      class={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm pointer-coarse:py-2 pointer-coarse:text-base outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        local.class,
      )}
      {...others}
    >
      <SelectPrimitive.ItemIndicator class="absolute right-2 flex size-4 items-center justify-center">
        <IconCheck class="size-4 text-primary" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  );
}
