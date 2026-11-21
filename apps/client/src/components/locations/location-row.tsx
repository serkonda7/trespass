import { Link } from "@tanstack/solid-router";
import type { LocationListItem } from "@trespass/shared/locations/types";
import { Show } from "solid-js";
import { CategoryIcon } from "~/components/locations/category-icon";
import { StatusBadge } from "~/components/locations/status-badge";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/cn";

/** One location in a list (map drawer, search): icon, name, status and tags. */
export function LocationRow(props: {
  location: LocationListItem;
  /** Category name shown next to the status (search lists it). */
  categoryName?: string;
  class?: string;
}) {
  const loc = () => props.location;
  return (
    // Only the name is the link (its accessible name stays the bare name); its
    // ::after stretches the click target over the whole row.
    <div
      class={cn(
        "relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent has-[:focus-visible]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
        props.class,
      )}
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
        <CategoryIcon name={loc().categoryIcon} class="size-4" />
      </span>
      <span class="grid min-w-0 flex-1 gap-1">
        <Link
          to="/locations/$locationId"
          params={{ locationId: loc().id }}
          class="truncate font-semibold outline-none after:absolute after:inset-0 after:content-['']"
        >
          {loc().name}
        </Link>
        <span class="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={loc().status} />
          <Show when={props.categoryName}>
            <Badge variant="outline">{props.categoryName}</Badge>
          </Show>
          <Show when={loc().country}>
            <Badge variant="outline">{loc().country}</Badge>
          </Show>
        </span>
      </span>
    </div>
  );
}
