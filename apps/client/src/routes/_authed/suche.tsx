import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { EmptyState, PageColumn, PageHeader } from "~/components/layout/page-header";
import { LocationRow } from "~/components/locations/location-row";
import { IconSearch, IconSearchOff } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { adoptTypedValue } from "~/lib/hydrated";
import { parseLocationSearch, patchLocationSearch, toListInput } from "~/lib/locations/list-search";
import { categoriesQuery, locationSearchQuery } from "~/lib/locations/queries";

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
    <PageColumn>
      <PageHeader title={m.search_title()} />
      <div class="grid gap-2">
        <Label for="search-q" class="sr-only">
          {m.search_label()}
        </Label>
        <div class="relative">
          <IconSearch class="pointer-events-none absolute left-3.5 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search-q"
            type="search"
            class="h-11 pl-10 text-base"
            ref={adoptTypedValue(text, setText)}
            value={text()}
            placeholder={m.search_placeholder()}
            autocomplete="off"
            onInput={(e) => {
              setText(e.currentTarget.value);
              searchLater(e.currentTarget.value);
            }}
          />
        </div>
        <p class="text-sm text-muted-foreground">{m.search_hint()}</p>
      </div>

      <Show when={search().q}>
        <p class="kicker" role="status">
          {m.search_count({ count: rows().length })}
        </p>
        <Show
          when={rows().length > 0}
          fallback={<EmptyState icon={<IconSearchOff />}>{m.search_empty()}</EmptyState>}
        >
          <ul
            class="divide-y overflow-hidden rounded-lg border bg-card"
            aria-label={m.search_title()}
          >
            <For each={rows()}>
              {(loc) => (
                <li>
                  <LocationRow location={loc} categoryName={categoryName(loc.categoryKey)} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </PageColumn>
  );
}
