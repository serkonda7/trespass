import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import type { Dashboard } from "@trespass/shared/dashboard/types";
import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { SerializedVisit } from "@trespass/shared/visits/types";
import { For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { EmptyState, PageColumn, PageHeader } from "~/components/layout/page-header";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  IconBook,
  IconChevronRight,
  IconMap,
  IconPhoto,
  IconPlus,
  IconRoute,
  IconTelescope,
} from "~/components/ui/icons";
import { cn } from "~/lib/cn";
import { dashboardQuery } from "~/lib/dashboard/queries";
import { tripStatusLabel } from "~/lib/labels";
import { STATUSES, statusColor, statusLabel } from "~/lib/locations/status";
import { tripDates } from "~/lib/trips/dates";

export const Route = createFileRoute("/_authed/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery()),
  head: () => ({ meta: [{ title: `${m.nav_dashboard()} · ${m.app_name()}` }] }),
  component: DashboardPage,
});

type Stat = {
  label: string;
  value: number;
  to: "/map" | "/logbuch" | "/fotos/unsortiert" | "/recherche";
  icon: (props: { class?: string }) => JSX.Element;
  /** Draws attention (something waits for the user). */
  pending?: boolean;
};

function stats(d: Dashboard, canUpload: boolean): Stat[] {
  const out: Stat[] = [
    { label: m.dashboard_locations(), value: d.locations, to: "/map", icon: IconMap },
    {
      label: m.dashboard_visits_year({ year: d.year.year }),
      value: d.year.visits,
      to: "/logbuch",
      icon: IconBook,
    },
    {
      label: m.dashboard_countries_year({ year: d.year.year }),
      value: d.year.countries,
      to: "/logbuch",
      icon: IconRoute,
    },
  ];
  if (canUpload) {
    out.push({
      label: m.photos_unsorted(),
      value: d.unsortedPhotos,
      to: "/fotos/unsortiert",
      icon: IconPhoto,
      pending: d.unsortedPhotos > 0,
    });
  }
  if (d.researchInbox !== undefined) {
    out.push({
      label: m.dashboard_inbox(),
      value: d.researchInbox,
      to: "/recherche",
      icon: IconTelescope,
      pending: d.researchInbox > 0,
    });
  }
  return out;
}

function StatTiles(props: { data: Dashboard; canUpload: boolean }) {
  return (
    <ul class="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
      <For each={stats(props.data, props.canUpload)}>
        {(s) => (
          <li>
            <Link
              to={s.to}
              class="group grid h-full gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="kicker truncate">{s.label}</span>
                <Dynamic
                  component={s.icon}
                  class={cn(
                    "size-4 shrink-0",
                    s.pending ? "text-primary" : "text-muted-foreground",
                  )}
                />
              </span>
              <span
                class={cn(
                  "font-mono text-3xl font-semibold leading-none tabular-nums",
                  s.pending && "text-primary",
                )}
              >
                {s.value}
              </span>
            </Link>
          </li>
        )}
      </For>
    </ul>
  );
}

function StatusCard(props: { data: Dashboard }) {
  const present = () => STATUSES.filter((s) => props.data.statusCounts[s] > 0);
  return (
    <Card>
      <CardHeader class="flex-row items-center justify-between gap-3">
        <CardTitle>
          <h2 class="section-title">{m.dashboard_status_title()}</h2>
        </CardTitle>
        <Link to="/map" class={buttonVariants({ variant: "ghost", size: "sm" })}>
          {m.dashboard_on_map()}
          <IconChevronRight />
        </Link>
      </CardHeader>
      <CardContent class="grid gap-4">
        <Show
          when={props.data.locations > 0}
          fallback={<EmptyState icon={<IconMap />}>{m.dashboard_status_empty()}</EmptyState>}
        >
          {/* Proportional strip; the list below carries the same numbers as text. */}
          <div class="flex h-3 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <For each={present()}>
              {(s) => (
                <span
                  class="h-full border-r border-card last:border-r-0"
                  style={{
                    width: `${(props.data.statusCounts[s] / props.data.locations) * 100}%`,
                    "background-color": statusColor(s),
                  }}
                />
              )}
            </For>
          </div>
          <ul class="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
            <For each={STATUSES}>
              {(s) => (
                <li>
                  <Link
                    to="/map"
                    search={{ status: [s] }}
                    class={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      props.data.statusCounts[s] === 0 && "text-muted-foreground",
                    )}
                  >
                    <span
                      class="size-2.5 shrink-0 rounded-full"
                      style={{ "background-color": statusColor(s) }}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1 truncate">{statusLabel(s)}</span>
                    <span class="font-mono tabular-nums">{props.data.statusCounts[s]}</span>
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </CardContent>
    </Card>
  );
}

const VISIT_ROW =
  "grid gap-1 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

/** One journal line: the place (or a placeholder once hidden), date, author, excerpt. */
function VisitRowBody(props: { visit: SerializedVisit }) {
  return (
    <>
      <span class="flex items-baseline justify-between gap-3">
        <span class={cn("truncate font-semibold", !props.visit.location && "italic")}>
          {props.visit.location?.name ?? m.dashboard_location_hidden()}
        </span>
        <span class="shrink-0 font-mono text-xs text-muted-foreground">
          {formatIsoDay(props.visit.visitedOn)}
        </span>
      </span>
      <span class="kicker normal-case tracking-normal">{props.visit.authorName}</span>
      <Show when={props.visit.excerpt}>
        <span class="line-clamp-2 text-sm text-muted-foreground">{props.visit.excerpt}</span>
      </Show>
    </>
  );
}

function RecentVisits(props: { data: Dashboard }) {
  return (
    <section class="grid content-start gap-3" aria-labelledby="dash-visits">
      <div class="flex items-center justify-between gap-3">
        <h2 id="dash-visits" class="section-title">
          {m.dashboard_recent_title()}
        </h2>
        <Link to="/logbuch" class={buttonVariants({ variant: "ghost", size: "sm" })}>
          {m.dashboard_to_logbook()}
          <IconChevronRight />
        </Link>
      </div>
      <Show
        when={props.data.recentVisits.length > 0}
        fallback={<EmptyState icon={<IconBook />}>{m.dashboard_recent_empty()}</EmptyState>}
      >
        <ul class="divide-y overflow-hidden rounded-lg border bg-card">
          <For each={props.data.recentVisits}>
            {(v) => (
              <li>
                <Show
                  when={v.location}
                  fallback={
                    <Link to="/logbuch" class={VISIT_ROW}>
                      <VisitRowBody visit={v} />
                    </Link>
                  }
                >
                  {(loc) => (
                    <Link
                      to="/locations/$locationId"
                      params={{ locationId: loc().id }}
                      class={VISIT_ROW}
                    >
                      <VisitRowBody visit={v} />
                    </Link>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function OpenTrips(props: { data: Dashboard }) {
  return (
    <section class="grid content-start gap-3" aria-labelledby="dash-trips">
      <div class="flex items-center justify-between gap-3">
        <h2 id="dash-trips" class="section-title">
          {m.dashboard_trips_title()}
        </h2>
        <Link to="/touren" class={buttonVariants({ variant: "ghost", size: "sm" })}>
          {m.dashboard_all_trips()}
          <IconChevronRight />
        </Link>
      </div>
      <Show
        when={props.data.openTrips.length > 0}
        fallback={<EmptyState icon={<IconRoute />}>{m.dashboard_trips_empty()}</EmptyState>}
      >
        <ul class="grid gap-2">
          <For each={props.data.openTrips}>
            {(t) => (
              <li>
                <Link
                  to="/touren/$tripId"
                  params={{ tripId: t.id }}
                  class="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
                    <IconRoute class="size-4" />
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
                    </span>
                  </span>
                  <IconChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function DashboardPage() {
  const ctx = Route.useRouteContext();
  const dashboard = useQuery(() => dashboardQuery());
  return (
    <PageColumn wide>
      <PageHeader
        kicker={m.nav_dashboard()}
        title={m.dashboard_greeting({ name: ctx().user.displayName })}
        actions={
          <>
            <Show when={can(ctx().user, "createLocation")}>
              <Link to="/locations/new" class={buttonVariants({})}>
                <IconPlus />
                {m.nav_new_location()}
              </Link>
            </Show>
            <Show when={can(ctx().user, "createTrip")}>
              <Link to="/touren/new" class={buttonVariants({ variant: "outline" })}>
                <IconRoute />
                {m.trips_new()}
              </Link>
            </Show>
          </>
        }
      />
      <Show when={dashboard.data}>
        {(data) => (
          <>
            <StatTiles data={data()} canUpload={ctx().user.role !== "guest"} />
            <StatusCard data={data()} />
            <div class="grid gap-4 md:grid-cols-2">
              <RecentVisits data={data()} />
              <OpenTrips data={data()} />
            </div>
          </>
        )}
      </Show>
    </PageColumn>
  );
}
