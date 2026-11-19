import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
export type BadgeVariantsProps = { variant?: BadgeVariant | null };

const BASE = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";
const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "text-foreground",
};

export function badgeVariants({ variant = "default" }: BadgeVariantsProps = {}) {
  return `${BASE} ${VARIANTS[variant ?? "default"]}`;
}

export function Badge(props: ComponentProps<"span"> & BadgeVariantsProps) {
  const [local, others] = splitProps(props, ["class", "variant"]);
  return <span class={cn(badgeVariants({ variant: local.variant }), local.class)} {...others} />;
}
