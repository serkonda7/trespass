import * as ButtonPrimitive from "@kobalte/core/button";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { type JSX, splitProps, type ValidComponent } from "solid-js";
import { cn } from "~/lib/cn";

export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";
export type ButtonVariantsProps = {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
};

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[color,background-color,border-color,transform] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const VARIANTS: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-primary/90",
  destructive:
    "border border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground",
  outline:
    "border border-border bg-card hover:border-input hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "text-foreground/90 hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};
const SIZES: Record<ButtonSize, string> = {
  default: "h-11 px-4 py-2", // 44px touch target
  sm: "h-9 rounded-md px-3",
  lg: "h-12 rounded-md px-6 text-base",
  icon: "size-11",
};

export function buttonVariants({
  variant = "default",
  size = "default",
}: ButtonVariantsProps = {}) {
  return `${BASE} ${VARIANTS[variant ?? "default"]} ${SIZES[size ?? "default"]}`;
}

type ButtonProps<T extends ValidComponent = "button"> = ButtonPrimitive.ButtonRootProps<T> &
  ButtonVariantsProps & { class?: string; children?: JSX.Element };

export function Button<T extends ValidComponent = "button">(
  props: PolymorphicProps<T, ButtonProps<T>>,
) {
  const [local, others] = splitProps(props as ButtonProps, ["variant", "size", "class"]);
  return (
    <ButtonPrimitive.Root
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...others}
    />
  );
}
