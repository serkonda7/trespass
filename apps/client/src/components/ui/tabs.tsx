import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as TabsPrimitive from "@kobalte/core/tabs";
import { splitProps, type ValidComponent } from "solid-js";
import { cn } from "~/lib/cn";

export const Tabs = TabsPrimitive.Root;

type ListProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsListProps<T> & {
  class?: string;
};
export function TabsList<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ListProps<T>>,
) {
  const [local, others] = splitProps(props as ListProps, ["class"]);
  return (
    <TabsPrimitive.List
      class={cn(
        "inline-flex h-9 items-stretch gap-1 border-b pointer-coarse:h-11 text-muted-foreground",
        local.class,
      )}
      {...others}
    />
  );
}

type TriggerProps<T extends ValidComponent = "button"> = TabsPrimitive.TabsTriggerProps<T> & {
  class?: string;
};
export function TabsTrigger<T extends ValidComponent = "button">(
  props: PolymorphicProps<T, TriggerProps<T>>,
) {
  const [local, others] = splitProps(props as TriggerProps, ["class"]);
  return (
    <TabsPrimitive.Trigger
      class={cn(
        "-mb-px inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[selected]:border-primary data-[selected]:text-foreground",
        local.class,
      )}
      {...others}
    />
  );
}

type ContentProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsContentProps<T> & {
  class?: string;
};
export function TabsContent<T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ContentProps<T>>,
) {
  const [local, others] = splitProps(props as ContentProps, ["class"]);
  return (
    <TabsPrimitive.Content
      class={cn(
        "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        local.class,
      )}
      {...others}
    />
  );
}
