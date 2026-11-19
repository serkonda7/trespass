// Route preview (DESIGN §5.5): straight lines and distances between stops.
// Points are the server-serialized ones, so a fuzzed stop gives an approximate
// leg. No turn-by-turn routing; "Öffnen in …" on each location hands off.
import { m } from "@trespass/shared/paraglide/messages";
import { formatDistance, routeLegs, routeTotal } from "@trespass/shared/trips/route";
import type { SerializedTripStop } from "@trespass/shared/trips/types";
import { createMemo, For, Show } from "solid-js";
import { type MapBbox, MapView } from "~/components/map/map-view";

export function RoutePreview(props: { stops: readonly SerializedTripStop[] }) {
  const points = createMemo(() =>
    props.stops.map((s) => ({
      id: s.location.id,
      name: s.location.name,
      status: s.location.status,
      categoryIcon: s.location.category?.icon ?? "",
      exact: s.location.exact,
      lat: s.location.point.lat,
      lon: s.location.point.lon,
    })),
  );
  const legs = createMemo(() =>
    routeLegs(props.stops.map((s) => ({ point: s.location.point, exact: s.location.exact }))),
  );
  const total = createMemo(() => routeTotal(legs()));
  const fit = createMemo<MapBbox | null>(() => {
    const p = points();
    if (p.length === 0) return null;
    const pad = 0.01;
    return {
      minLat: Math.min(...p.map((x) => x.lat)) - pad,
      maxLat: Math.max(...p.map((x) => x.lat)) + pad,
      minLon: Math.min(...p.map((x) => x.lon)) - pad,
      maxLon: Math.max(...p.map((x) => x.lon)) + pad,
    };
  });

  return (
    <div class="grid gap-3" data-testid="route-preview">
      <div class="h-64 overflow-hidden rounded-md border">
        <MapView
          points={points()}
          route={props.stops.map((s) => s.location.point)}
          fit={fit()}
          label={m.trips_route()}
          class="size-full"
        />
      </div>
      <Show when={legs().length > 0}>
        <ol class="grid gap-1 text-sm" aria-label={m.trips_route_legs()}>
          <For each={legs()}>
            {(leg) => (
              <li class="flex justify-between gap-2">
                <span>
                  {props.stops[leg.from]?.location.name} → {props.stops[leg.to]?.location.name}
                </span>
                <span class="whitespace-nowrap tabular-nums">
                  {leg.approximate ? "≈ " : ""}
                  {formatDistance(leg.meters)}
                </span>
              </li>
            )}
          </For>
          <li
            class="flex justify-between gap-2 border-t pt-1 font-semibold"
            data-testid="route-total"
          >
            <span>{m.trips_route_total()}</span>
            <span class="whitespace-nowrap tabular-nums">
              {total().approximate ? "≈ " : ""}
              {formatDistance(total().meters)}
            </span>
          </li>
        </ol>
        <p class="text-xs text-muted-foreground">
          {m.trips_route_hint()}
          <Show when={total().approximate}> {m.trips_route_approximate()}</Show>
        </p>
      </Show>
    </div>
  );
}
