import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "~/lib/cn";

const make = (base: string) => (props: ComponentProps<"div">) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn(base, local.class)} {...others} />;
};

export const Card = make("rounded-lg border bg-card text-card-foreground");
export const CardHeader = make("flex flex-col gap-1 p-3.5");
export const CardTitle = make("section-title");
export const CardDescription = make("text-sm text-muted-foreground");
export const CardContent = make("p-3.5 pt-0");
export const CardFooter = make("flex items-center p-3.5 pt-0");
