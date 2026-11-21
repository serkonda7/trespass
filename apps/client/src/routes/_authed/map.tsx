import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import type { LocationStatus } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { LocationRow } from "~/components/locations/location-row";
import { type MapBbox, type MapPoint, MapView } from "~/components/map/map-view";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  IconAdjustmentsHorizontal,
  IconList,
  IconPlus,
  IconSearch,
  IconX,
} from "~/components/ui/icons";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/cn";
import { adoptTypedValue } from "~/lib/hydrated";
import {
  activeFilterCount,
  parseLocationSearch,
  patchLocationSearch,
  toListInput,
} from "~/lib/locations/list-search";
import { categoriesQuery, locationListQuery } from "~/lib/locations/queries";
import { STATUSES, statusLabel } from "~/lib/locations/status";

export const Route = createFileRoute("/_authed/map")({
  validateSearch: parseLocationSearch,
  head: () => ({ meta: [{ title: `${m.nav_map()} · ${m.app_name()}` }] }),
  component: MapPage,
});

const GERMANY: MapBbox = { minLat: 47, minLon: 5, maxLat: 55.5, maxLon: 15.5 };

function bboxOfPoints(points: readonly MapPoint[]): MapBbox | null {
  if (!points.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  if (minLat === maxLat) {
    minLat -= 0.01;
    maxLat += 0.01;
  }
  if (minLon === maxLon) {
    minLon -= 0.01;
    maxLon += 0.01;
  }
  return { minLat, minLon, maxLat, maxLon };
}

function MapPage() {
  const search = Route.useSearch();
  const ctx = Route.useRouteContext();
  const navigate = useNavigate({ from: "/map" });
  const categories = useQuery(() => categoriesQuery());
  const [bbox, setBbox] = createSignal<MapBbox | null>(null);
  const [usedBbox, setUsedBbox] = createSignal<MapBbox | null>(null);
  const [showList, setShowList] = createSignal(false);
  const [showFilters, setShowFilters] = createSignal(false);
  const [text, setText] = createSignal(search().q ?? "");
  const [tag, setTag] = createSignal(search().tag?.[0] ?? "");
  const [country, setCountry] = createSignal(search().country?.[0] ?? "");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(searchTimer));

  createEffect(() => {
    const next = bbox();
    const timer = setTimeout(() => setUsedBbox(next), 300);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => setText(search().q ?? ""));
  createEffect(() => setTag(search().tag?.[0] ?? ""));
  createEffect(() => setCountry(search().country?.[0] ?? ""));

  const go = (patch: Parameters<typeof patchLocationSearch>[1], replace = true) =>
    void navigate({
      search: (s) => patchLocationSearch(s as never, patch),
      replace,
      resetScroll: false,
    });

  const list = useQuery(() =>
    locationListQuery(toListInput(search(), { bbox: usedBbox() ?? undefined, limit: 2000 })),
  );
  const points = createMemo<MapPoint[]>(() =>
    (list.data?.rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      categoryIcon: r.categoryIcon,
      exact: r.exact,
      lat: r.point.lat,
      lon: r.point.lon,
    })),
  );

  // Fit once after the initial (unfiltered by bbox) load, then let the user
  // pan/zoom freely. The memo settles on that first box and keeps it, so the
  // map sees one change (null → box) and never refits on later refetches.
  const initial = useQuery(() => locationListQuery(toListInput(search(), { limit: 2000 })));
  let firstFit: MapBbox | null = null;
  const fit = createMemo<MapBbox | null>(() => {
    if (firstFit) return firstFit;
    if (initial.isFetching) return null;
    firstFit =
      bboxOfPoints(
        (initial.data?.rows ?? []).map((r) => ({ ...r, lat: r.point.lat, lon: r.point.lon })),
      ) ?? GERMANY;
    return firstFit;
  });

  const searchLater = (key: "q" | "tag" | "country", value: string) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = value.trim();
      go({ [key]: v ? (key === "q" ? v : [v]) : undefined });
    }, 350);
  };

  const filterCount = () => activeFilterCount(search());
  const fieldClass = "grid gap-1.5";

  return (
    <div class="tr-map-page relative h-[calc(100dvh-var(--header-h))] overflow-hidden">
      {/* Kept for existing e2e fixtures that sign in and land on / */}
      <h1 class="sr-only">{m.nav_map()}</h1>

      <div class="grid-paper absolute inset-0">
        <MapView
          points={points()}
          onMoveEnd={setBbox}
          fit={fit()}
          fitPadding={{ top: 96, bottom: 112, left: 40, right: 72 }}
          label={m.nav_map()}
          class="size-full"
        />
      </div>

      {/* Search, filters and the count float over the map. */}
      <div class="pointer-events-none absolute inset-x-0 top-0 z-10 grid gap-2 p-3 md:max-w-md">
        <div class="pointer-events-auto flex gap-2">
          <div class="relative min-w-0 flex-1">
            <Label for="map-search" class="sr-only">
              {m.map_filter_search()}
            </Label>
            <IconSearch class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="map-search"
              type="search"
              placeholder={m.map_filter_search()}
              class="border-border bg-popover/95 pl-9 shadow-lg shadow-black/30 backdrop-blur"
              ref={adoptTypedValue(text, setText)}
              value={text()}
              onInput={(e) => {
                setText(e.currentTarget.value);
                searchLater("q", e.currentTarget.value);
              }}
            />
          </div>
          <Button
            variant="outline"
            class={cn(
              "relative bg-popover/95 shadow-lg shadow-black/30 backdrop-blur",
              filterCount() > 0 && "border-primary/60",
            )}
            aria-expanded={showFilters()}
            aria-controls="map-filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconAdjustmentsHorizontal />
            <span class="sr-only sm:not-sr-only">{m.map_filters()}</span>
            <Show when={filterCount() > 0}>
              <span
                class="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[0.65rem] text-primary-foreground"
                aria-hidden="true"
              >
                {filterCount()}
              </span>
              <span class="sr-only">{m.map_filters_active({ count: filterCount() })}</span>
            </Show>
          </Button>
        </div>

        <Show when={showFilters()}>
          <section
            id="map-filters"
            aria-label={m.map_filters()}
            class="tr-animate-slide pointer-events-auto grid gap-3 rounded-lg border bg-popover/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
            data-opened
          >
            <div class="grid grid-cols-2 gap-3">
              <div class={fieldClass}>
                <Label for="map-status">{m.map_filter_status()}</Label>
                <select
                  id="map-status"
                  class={inputClass}
                  value={search().status?.[0] ?? ""}
                  onChange={(e) =>
                    go({
                      status: e.currentTarget.value
                        ? [e.currentTarget.value as LocationStatus]
                        : undefined,
                    })
                  }
                >
                  <option value="">{m.map_filter_all()}</option>
                  <For each={STATUSES}>{(s) => <option value={s}>{statusLabel(s)}</option>}</For>
                </select>
              </div>
              <div class={fieldClass}>
                <Label for="map-category">{m.map_filter_category()}</Label>
                <select
                  id="map-category"
                  class={inputClass}
                  value={search().category?.[0] ?? ""}
                  onChange={(e) =>
                    go({ category: e.currentTarget.value ? [e.currentTarget.value] : undefined })
                  }
                >
                  <option value="">{m.map_filter_all()}</option>
                  <For each={categories.data ?? []}>
                    {(c) => <option value={c.id}>{c.name}</option>}
                  </For>
                </select>
              </div>
              <div class={fieldClass}>
                <Label for="map-tag">{m.map_filter_tag()}</Label>
                <Input
                  id="map-tag"
                  ref={adoptTypedValue(tag, setTag)}
                  value={tag()}
                  onInput={(e) => {
                    setTag(e.currentTarget.value);
                    searchLater("tag", e.currentTarget.value);
                  }}
                />
              </div>
              <div class={fieldClass}>
                <Label for="map-country">{m.map_filter_country()}</Label>
                <Input
                  id="map-country"
                  ref={adoptTypedValue(country, setCountry)}
                  value={country()}
                  onInput={(e) => {
                    setCountry(e.currentTarget.value);
                    searchLater("country", e.currentTarget.value);
                  }}
                />
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <Show when={filterCount() > 0}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    go({
                      status: undefined,
                      category: undefined,
                      tag: undefined,
                      country: undefined,
                    })
                  }
                >
                  {m.map_filter_reset()}
                </Button>
              </Show>
              <Button variant="outline" size="sm" onClick={() => setShowFilters(false)}>
                {m.common_close()}
              </Button>
            </div>
          </section>
        </Show>
      </div>

      {/* IconList: a bottom sheet on phones, a side panel from md. */}
      <Show when={showList()}>
        <section
          aria-label={m.map_list()}
          class="tr-animate-slide absolute inset-x-0 bottom-0 z-20 flex max-h-[60%] flex-col rounded-t-xl border-t bg-popover shadow-2xl shadow-black/60 md:inset-x-auto md:bottom-3 md:left-3 md:top-[4.25rem] md:max-h-none md:w-96 md:rounded-xl md:border"
          data-opened
        >
          <div class="flex items-center justify-between gap-2 border-b px-4 py-2">
            <p class="kicker" aria-hidden="true">
              {m.map_count({ count: points().length })}
            </p>
            <Button
              variant="ghost"
              size="icon"
              class="-mr-2 size-10"
              aria-label={m.map_list_hide()}
              onClick={() => setShowList(false)}
            >
              <IconX />
            </Button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={points().length === 0}
              fallback={
                <ul class="divide-y">
                  <For each={list.data?.rows ?? []}>
                    {(loc) => (
                      <li>
                        <LocationRow location={loc} />
                      </li>
                    )}
                  </For>
                </ul>
              }
            >
              <p class="p-4 text-sm text-muted-foreground">{m.map_list_empty()}</p>
            </Show>
          </div>
        </section>
      </Show>

      {/* Bottom bar: count + list toggle on the left, the add button on the right. */}
      <Show when={!showList()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-3 pb-8">
          <Button
            variant="outline"
            class="pointer-events-auto bg-popover/95 shadow-lg shadow-black/30 backdrop-blur"
            aria-expanded={showList()}
            onClick={() => setShowList(true)}
          >
            <IconList />
            {m.map_list()}
            <span class="font-mono text-xs text-muted-foreground" role="status">
              {m.map_count({ count: points().length })}
            </span>
          </Button>
          <Show when={can({ role: ctx().user.role }, "createLocation")}>
            <Link
              to="/locations/new"
              class={cn(
                buttonVariants({ size: "lg" }),
                "pointer-events-auto rounded-full pl-4 shadow-xl shadow-black/40",
              )}
            >
              <IconPlus class="size-5" />
              {m.map_add()}
            </Link>
          </Show>
        </div>
      </Show>
    </div>
  );
}
