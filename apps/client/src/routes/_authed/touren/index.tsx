import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { TripSummary } from "@trespass/shared/trips/types";
import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { tripStatusLabel } from "~/lib/labels";
import { tripsQuery } from "~/lib/trips/queries";

export const Route = createFileRoute("/_authed/touren/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(tripsQuery()),
  head: () => ({ meta: [{ title: `${m.trips_title()} · ${m.app_name()}` }] }),
  component: TripsPage,
});

export function tripDates(t: Pick<TripSummary, "startsOn" | "endsOn">): string {
  if (!t.startsOn) return m.trips_no_date();
  if (!t.endsOn || t.endsOn === t.startsOn) return formatIsoDay(t.startsOn);
  return `${formatIsoDay(t.startsOn)} – ${formatIsoDay(t.endsOn)}`;
}

function TripsPage() {
  const ctx = Route.useRouteContext();
  const trips = useQuery(() => tripsQuery());
  return (
    <div class="mx-auto grid max-w-3xl grid-cols-1 gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-2xl font-semibold">{m.trips_title()}</h1>
        <Show when={can(ctx().user, "createTrip")}>
          <Link to="/touren/new" class={buttonVariants({})} data-testid="new-trip">
            {m.trips_new()}
          </Link>
        </Show>
      </div>
      <Show
        when={(trips.data?.length ?? 0) > 0}
        fallback={
          <Card>
            <CardContent class="pt-4">{m.trips_empty()}</CardContent>
          </Card>
        }
      >
        <ul class="grid gap-3">
          <For each={trips.data ?? []}>
            {(t) => (
              <li>
                <Card data-testid="trip-card">
                  <CardContent class="grid gap-1 pt-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <Link
                        to="/touren/$tripId"
                        params={{ tripId: t.id }}
                        class="font-semibold text-primary underline underline-offset-4"
                      >
                        {t.title}
                      </Link>
                      <Badge variant={t.status === "active" ? "default" : "secondary"}>
                        {tripStatusLabel(t.status)}
                      </Badge>
                    </div>
                    <p class="text-sm text-muted-foreground">
                      {tripDates(t)} · {m.trips_stop_count({ count: t.stopCount })}
                      <Show when={!t.isOwner}> · {m.trips_by({ name: t.ownerName })}</Show>
                    </p>
                  </CardContent>
                </Card>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
