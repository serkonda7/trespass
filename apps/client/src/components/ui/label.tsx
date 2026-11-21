import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

export function Label(props: ComponentProps<"label">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers pass `for`
    <label
      class={cn(
        "text-sm font-semibold leading-none text-foreground/90 peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        local.class,
      )}
      {...others}
    />
  );
}
