// Search box + result list for picking one location (search areas, merge
// targets). Uses the normal search, so only visible locations appear.
import { useQuery } from "@tanstack/solid-query";
import type { LocationListItem } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { locationSearchQuery } from "~/lib/locations/queries";

export function LocationPicker(props: {
  id: string;
  label: string;
  onPick: (row: LocationListItem) => void;
  excludeId?: string;
}) {
  const [text, setText] = createSignal("");
  const [q, setQ] = createSignal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const results = useQuery(() => ({
    ...locationSearchQuery({ q: q(), limit: 8 }),
    enabled: q().length >= 2,
  }));
  const rows = () => (results.data?.rows ?? []).filter((r) => r.id !== props.excludeId);
  return (
    <div class="grid gap-2">
      <Input
        id={props.id}
        type="search"
        aria-label={props.label}
        placeholder={m.research_area_location_search()}
        value={text()}
        onInput={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          clearTimeout(timer);
          timer = setTimeout(() => setQ(v.trim()), 300);
        }}
      />
      <Show when={q().length >= 2}>
        <Show
          when={rows().length > 0}
          fallback={<p class="text-sm text-muted-foreground">{m.research_area_location_none()}</p>}
        >
          <ul class="grid gap-1">
            <For each={rows()}>
              {(row) => (
                <li class="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span>
                    {row.name}
                    <Show when={row.country}>
                      <span class="text-muted-foreground"> · {row.country}</span>
                    </Show>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => props.onPick(row)}
                  >
                    {m.research_merge_pick()}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
