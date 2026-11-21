import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { TripSummary } from "@trespass/shared/trips/types";
import { For, Show } from "solid-js";
import { EmptyState, PageColumn, PageHeader } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { IconChevronRight, IconPlus, IconRoute } from "~/components/ui/icons";
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
    <PageColumn>
      <PageHeader
        title={m.trips_title()}
        actions={
          <Show when={can(ctx().user, "createTrip")}>
            <Link to="/touren/new" class={buttonVariants({})} data-testid="new-trip">
              <IconPlus />
              {m.trips_new()}
            </Link>
          </Show>
        }
      />
      <Show
        when={(trips.data?.length ?? 0) > 0}
        fallback={<EmptyState icon={<IconRoute />}>{m.trips_empty()}</EmptyState>}
      >
        <ul class="grid gap-3">
          <For each={trips.data ?? []}>
            {(t) => (
              <li>
                <Link
                  to="/touren/$tripId"
                  params={{ tripId: t.id }}
                  class="group flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-input hover:bg-accent"
                  data-testid="trip-card"
                >
                  <span class="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
                    <IconRoute class="size-5" />
                  </span>
                  <span class="grid min-w-0 flex-1 gap-1">
                    <span class="flex flex-wrap items-center gap-2">
                      <span class="truncate font-bold">{t.title}</span>
                      <Badge variant={t.status === "active" ? "default" : "secondary"}>
                        {tripStatusLabel(t.status)}
                      </Badge>
                    </span>
                    <span class="kicker normal-case tracking-normal">
                      {tripDates(t)} · {m.trips_stop_count({ count: t.stopCount })}
                      <Show when={!t.isOwner}> · {m.trips_by({ name: t.ownerName })}</Show>
                    </span>
                  </span>
                  <IconChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </PageColumn>
  );
}
