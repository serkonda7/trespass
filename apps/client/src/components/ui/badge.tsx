import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
export type BadgeVariantsProps = { variant?: BadgeVariant | null };

/** Small label-maker tag: mono, uppercase, square-ish. */
const BASE =
  "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase leading-none tracking-wide whitespace-nowrap";
const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-destructive/50 bg-destructive/10 text-destructive",
  outline: "text-muted-foreground",
};

export function badgeVariants({ variant = "default" }: BadgeVariantsProps = {}) {
  return `${BASE} ${VARIANTS[variant ?? "default"]}`;
}

export function Badge(props: ComponentProps<"span"> & BadgeVariantsProps) {
  const [local, others] = splitProps(props, ["class", "variant"]);
  return <span class={cn(badgeVariants({ variant: local.variant }), local.class)} {...others} />;
}
