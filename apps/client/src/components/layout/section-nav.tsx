import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import { cn } from "~/lib/cn";

/** Underlined section links below a page title (admin, research). */
export function SectionNav(props: {
  label: string;
  items: readonly { to: string; label: () => string }[];
  isActive: (to: string) => boolean;
}) {
  return (
    <nav aria-label={props.label} class="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul class="flex gap-1 border-b">
        <For each={props.items}>
          {(item) => (
            <li>
              <Link
                to={item.to as "/"}
                class={cn(
                  "-mb-px inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors",
                  props.isActive(item.to)
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-current={props.isActive(item.to) ? "page" : undefined}
              >
                {item.label()}
              </Link>
            </li>
          )}
        </For>
      </ul>
    </nav>
  );
}
