import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

export const inputClass =
  "flex h-11 w-full rounded-md border border-input/70 bg-background px-3 py-2 text-base ring-offset-background transition-colors placeholder:text-muted-foreground/80 hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive";

/** Plain input; pair with <Label for=...>. Base font 16px avoids zoom on phones. */
export function Input(props: ComponentProps<"input">) {
  const [local, others] = splitProps(props, ["class", "type"]);
  return <input type={local.type ?? "text"} class={cn(inputClass, local.class)} {...others} />;
}
