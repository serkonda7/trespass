import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import type { LocationStatus } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { type MapBbox, type MapPoint, MapView } from "~/components/map/map-view";
import { Button } from "~/components/ui/button";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { adoptTypedValue } from "~/lib/hydrated";
import {
  activeFilterCount,
  parseLocationSearch,
  patchLocationSearch,
  toListInput,
} from "~/lib/locations/list-search";
import { categoriesQuery, locationListQuery } from "~/lib/locations/queries";
import { STATUSES, statusLabel } from "~/lib/locations/status";

export const Route = createFileRoute("/_authed/")({
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
  const navigate = useNavigate({ from: "/" });
  const categories = useQuery(() => categoriesQuery());
  const [bbox, setBbox] = createSignal<MapBbox | null>(null);
  const [usedBbox, setUsedBbox] = createSignal<MapBbox | null>(null);
  const [showList, setShowList] = createSignal(false);
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
  // pan/zoom freely. `fit` stays null on later moves.
  const initial = useQuery(() => locationListQuery(toListInput(search(), { limit: 2000 })));
  const [fitted, setFitted] = createSignal(false);
  const fit = createMemo<MapBbox | null>(() => {
    if (fitted() || initial.isFetching) return null;
    return (
      bboxOfPoints(
        (initial.data?.rows ?? []).map((r) => ({ ...r, lat: r.point.lat, lon: r.point.lon })),
      ) ?? GERMANY
    );
  });
  createEffect(() => {
    if (fit()) setFitted(true);
  });

  const searchLater = (key: "q" | "tag" | "country", value: string) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = value.trim();
      go({ [key]: v ? (key === "q" ? v : [v]) : undefined });
    }, 350);
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Kept for existing e2e fixtures that sign in and land on / */}
      <h1 class="sr-only">{m.home_hello()}</h1>

      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-48 flex-1">
          <Label for="map-search">{m.map_filter_search()}</Label>
          <Input
            id="map-search"
            ref={adoptTypedValue(text, setText)}
            value={text()}
            onInput={(e) => {
              setText(e.currentTarget.value);
              searchLater("q", e.currentTarget.value);
            }}
          />
        </div>
        <div>
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
        <div>
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
            <For each={categories.data ?? []}>{(c) => <option value={c.id}>{c.name}</option>}</For>
          </select>
        </div>
        <div>
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
        <div>
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
        <Show when={activeFilterCount(search()) > 0}>
          <Button
            variant="ghost"
            onClick={() =>
              go({ status: undefined, category: undefined, tag: undefined, country: undefined })
            }
          >
            {m.map_filter_reset()}
          </Button>
        </Show>
        <Button variant="outline" aria-expanded={showList()} onClick={() => setShowList((v) => !v)}>
          {showList() ? m.map_list_hide() : m.map_list()}
        </Button>
        <Show when={can({ role: ctx().user.role }, "createLocation")}>
          <Button as={Link} to="/locations/new">
            {m.map_add()}
          </Button>
        </Show>
      </div>

      <p class="text-sm text-muted-foreground" role="status">
        {m.map_count({ count: points().length })}
      </p>

      <Show when={showList()}>
        <section aria-label={m.map_list()} class="max-h-64 overflow-y-auto rounded-md border">
          <Show
            when={points().length === 0}
            fallback={
              <ul class="divide-y">
                <For each={list.data?.rows ?? []}>
                  {(loc) => (
                    <li class="flex items-center justify-between gap-3 p-3">
                      <Link
                        to="/locations/$locationId"
                        params={{ locationId: loc.id }}
                        class="font-medium hover:underline"
                      >
                        {loc.name}
                      </Link>
                      <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <span>{statusLabel(loc.status)}</span>
                        <Show when={!loc.exact}>
                          <span class="rounded-full border px-2 py-0.5">
                            {m.location_approximate()}
                          </span>
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            }
          >
            <p class="p-4 text-sm text-muted-foreground">{m.map_list_empty()}</p>
          </Show>
        </section>
      </Show>

      <div class="h-[min(70dvh,720px)] overflow-hidden rounded-md border">
        <MapView
          points={points()}
          onMoveEnd={setBbox}
          fit={fit()}
          label={m.nav_map()}
          class="size-full"
        />
      </div>
    </div>
  );
}
