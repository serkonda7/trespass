import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

export function Textarea(props: ComponentProps<"textarea">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <textarea
      class={cn(
        "flex min-h-20 w-full rounded-md border border-input/70 bg-background px-3 py-2 text-sm pointer-coarse:text-base transition-colors placeholder:text-muted-foreground/80 hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
}
