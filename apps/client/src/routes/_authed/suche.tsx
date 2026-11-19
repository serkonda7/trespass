import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { adoptTypedValue } from "~/lib/hydrated";
import { parseLocationSearch, patchLocationSearch, toListInput } from "~/lib/locations/list-search";
import { categoriesQuery, locationSearchQuery } from "~/lib/locations/queries";
import { statusLabel } from "~/lib/locations/status";

export const Route = createFileRoute("/_authed/suche")({
  validateSearch: parseLocationSearch,
  head: () => ({ meta: [{ title: `${m.search_title()} · ${m.app_name()}` }] }),
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/suche" });
  const [text, setText] = createSignal(search().q ?? "");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(searchTimer));
  createEffect(() => setText(search().q ?? ""));

  const go = (q: string) =>
    void navigate({
      search: (s) => patchLocationSearch(s as never, { q: q || undefined }),
      replace: true,
      resetScroll: false,
    });

  const searchLater = (value: string) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => go(value.trim()), 350);
  };

  const results = useQuery(() => locationSearchQuery(toListInput(search(), { limit: 200 })));
  const categories = useQuery(() => categoriesQuery());
  const rows = createMemo(() => results.data?.rows ?? []);
  const categoryName = (key: string) => categories.data?.find((c) => c.key === key)?.name ?? key;

  return (
    <div class="mx-auto grid max-w-3xl gap-4">
      <h1 class="text-2xl font-semibold">{m.search_title()}</h1>
      <div>
        <Label for="search-q">{m.search_label()}</Label>
        <Input
          id="search-q"
          ref={adoptTypedValue(text, setText)}
          value={text()}
          placeholder={m.search_placeholder()}
          autocomplete="off"
          onInput={(e) => {
            setText(e.currentTarget.value);
            searchLater(e.currentTarget.value);
          }}
        />
        <p class="mt-1 text-sm text-muted-foreground">{m.search_hint()}</p>
      </div>

      <Show when={search().q}>
        <p class="text-sm text-muted-foreground" role="status">
          {m.search_count({ count: rows().length })}
        </p>
        <Show
          when={rows().length > 0}
          fallback={<p class="p-4 text-sm text-muted-foreground">{m.search_empty()}</p>}
        >
          <ul class="grid gap-2" aria-label={m.search_title()}>
            <For each={rows()}>
              {(loc) => (
                <li class="rounded-md border p-3">
                  <Link
                    to="/locations/$locationId"
                    params={{ locationId: loc.id }}
                    class="font-medium hover:underline"
                  >
                    {loc.name}
                  </Link>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{categoryName(loc.categoryKey)}</span>
                    <span>{statusLabel(loc.status)}</span>
                    <Show when={loc.country}>
                      <span>{loc.country}</span>
                    </Show>
                    <Show when={!loc.exact}>
                      <Badge variant="outline">{m.location_approximate()}</Badge>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
