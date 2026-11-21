import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/solid-router";
import { deleteTripFn, setTripStopsFn } from "@trespass/server/trips/functions";
import { can } from "@trespass/shared/app-actions";
import { errorCode } from "@trespass/shared/error-text";
import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { SerializedTrip } from "@trespass/shared/trips/types";
import { For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { EmptyState } from "~/components/layout/page-header";
import { StatusBadge } from "~/components/locations/status-badge";
import { PackingList } from "~/components/trips/packing-list";
import { RoutePreview } from "~/components/trips/route-preview";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  IconArrowDown,
  IconArrowUp,
  IconPencil,
  IconPhoneCall,
  IconUsers,
  IconX,
} from "~/components/ui/icons";
import { tripStatusLabel } from "~/lib/labels";
import { runAction } from "~/lib/run-action";
import { tripDates } from "~/lib/trips/dates";
import { tripQuery } from "~/lib/trips/queries";

export const Route = createFileRoute("/_authed/touren/$tripId/")({
  beforeLoad: ({ params }) => {
    if (params.tripId.length > 64) throw notFound();
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(tripQuery(params.tripId)).catch((err: unknown) => {
      if (errorCode(err) === "TRIP_NOT_FOUND") throw notFound();
      throw err;
    }),
  notFoundComponent: () => (
    <EmptyState class="mx-auto max-w-lg">
      <h1 class="section-title mb-2 text-foreground">{m.trips_error_not_found()}</h1>
      <Link to="/touren" class="text-primary underline underline-offset-4">
        {m.trips_back()}
      </Link>
    </EmptyState>
  ),
  head: () => ({ meta: [{ title: `${m.trips_title()} · ${m.app_name()}` }] }),
  component: TripPage,
});

function TripPage() {
  const params = Route.useParams();
  const ctx = Route.useRouteContext();
  const q = useQuery(() => tripQuery(params().tripId));
  return (
    <Show
      when={q.data}
      fallback={<EmptyState class="mx-auto max-w-lg">{m.common_loading()}</EmptyState>}
    >
      {(trip) => (
        <TripView
          trip={trip()}
          canOwnEquipment={can(ctx().user, "ownEquipment")}
          canAddVisit={ctx().user.role !== "guest"}
        />
      )}
    </Show>
  );
}

function TripView(props: { trip: SerializedTrip; canOwnEquipment: boolean; canAddVisit: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = () => props.trip;
  const refresh = () => qc.invalidateQueries({ queryKey: ["trips"] });

  const move = async (index: number, delta: -1 | 1) => {
    const ids = t().stops.map((s) => s.location.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    const r = await runAction(() => setTripStopsFn({ data: { id: t().id, locationIds: ids } }));
    if (r) await refresh();
  };
  const removeStop = async (locationId: string) => {
    const ids = t()
      .stops.map((s) => s.location.id)
      .filter((id) => id !== locationId);
    const r = await runAction(() => setTripStopsFn({ data: { id: t().id, locationIds: ids } }), {
      success: m.trips_stop_removed(),
    });
    if (r) await refresh();
  };
  const remove = async () => {
    const r = await runAction(() => deleteTripFn({ data: { id: t().id } }), {
      success: m.trips_deleted(),
    });
    if (r) {
      await qc.invalidateQueries({ queryKey: ["trips"] });
      await navigate({ to: "/touren", replace: true });
    }
  };

  return (
    <div class="mx-auto grid max-w-3xl grid-cols-1 gap-4">
      <section class="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div class="grid gap-2">
          <p class="kicker flex flex-wrap items-center gap-x-2">
            <span>{tripDates(t())}</span>
            <span aria-hidden="true">·</span>
            <span>{m.trips_by({ name: t().ownerName })}</span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="page-title text-3xl">{t().title}</h1>
            <Badge variant={t().status === "active" ? "default" : "secondary"}>
              {tripStatusLabel(t().status)}
            </Badge>
          </div>
        </div>
        <div class="grid gap-2 empty:hidden">
          <Show when={t().people.length > 0}>
            <p class="flex items-start gap-2 text-sm">
              <IconUsers class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {m.visits_with_people({
                names: t()
                  .people.map((p) => p.displayName)
                  .join(", "),
              })}
            </p>
          </Show>
          <Show when={t().emergencyContact}>
            {(c) => (
              <p class="flex items-start gap-2 text-sm" data-testid="trip-emergency-contact">
                <IconPhoneCall class="mt-0.5 size-4 shrink-0 text-warning" />
                <strong>{m.trips_emergency_contact()}:</strong>{" "}
                {c().kind === "user"
                  ? (c() as { displayName: string }).displayName
                  : [
                      (c() as { name: string }).name,
                      (c() as { email: string | null }).email,
                      (c() as { ntfyTopic: string | null }).ntfyTopic
                        ? `ntfy: ${(c() as { ntfyTopic: string }).ntfyTopic}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            )}
          </Show>
        </div>
        <Show when={t().notes}>
          <p class="whitespace-pre-wrap leading-relaxed">{t().notes}</p>
        </Show>
        <Show when={t().permissions.canEdit}>
          <div class="flex flex-wrap gap-2 border-t pt-4">
            <Link
              to="/touren/$tripId/edit"
              params={{ tripId: t().id }}
              class={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <IconPencil />
              {m.trips_edit()}
            </Link>
            <ConfirmButton
              label={m.trips_delete()}
              question={m.trips_delete_confirm()}
              confirmLabel={m.trips_delete()}
              destructive
              variant="destructive"
              onConfirm={remove}
            />
          </div>
        </Show>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 class="section-title">{m.trips_stops()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent class="grid gap-3">
          <Show
            when={t().stops.length > 0}
            fallback={<p class="text-sm text-muted-foreground">{m.trips_stops_empty()}</p>}
          >
            <RoutePreview stops={t().stops} />
            <ol class="grid gap-2" data-testid="trip-stops">
              <For each={t().stops}>
                {(stop, i) => (
                  <li class="flex items-start gap-3 rounded-lg border bg-background/40 p-3">
                    <span class="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/50 font-mono text-xs font-semibold text-primary">
                      {i() + 1}
                    </span>
                    <div class="grid min-w-0 flex-1 gap-2">
                      <Link
                        to="/locations/$locationId"
                        params={{ locationId: stop.location.id }}
                        class="font-semibold leading-tight hover:text-primary hover:underline"
                      >
                        {stop.location.name}
                      </Link>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={stop.location.status} />
                      </div>
                      <div class="flex flex-wrap items-center gap-1 empty:hidden">
                        <Show when={props.canAddVisit && stop.location.permissions.canContribute}>
                          <Link
                            to="/visits/new"
                            search={{ location: stop.location.id, trip: t().id }}
                            class={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            {m.visits_add()}
                          </Link>
                        </Show>
                        <Show when={t().permissions.canEdit}>
                          <span class="ml-auto flex gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              class="size-9 px-0"
                              aria-label={m.trips_stop_up({ name: stop.location.name })}
                              disabled={i() === 0}
                              onClick={() => void move(i(), -1)}
                            >
                              <IconArrowUp />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="size-9 px-0"
                              aria-label={m.trips_stop_down({ name: stop.location.name })}
                              disabled={i() === t().stops.length - 1}
                              onClick={() => void move(i(), 1)}
                            >
                              <IconArrowDown />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="size-9 px-0 text-destructive hover:text-destructive"
                              aria-label={m.trips_stop_remove({ name: stop.location.name })}
                              onClick={() => void removeStop(stop.location.id)}
                            >
                              <IconX />
                            </Button>
                          </span>
                        </Show>
                      </div>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
          <Show when={(t().hiddenStops ?? 0) > 0}>
            <p class="text-sm text-muted-foreground">
              {m.trips_hidden_stops({ count: t().hiddenStops ?? 0 })}
            </p>
          </Show>
          <Show when={t().permissions.canEdit}>
            <p class="text-xs text-muted-foreground">{m.trips_stops_hint()}</p>
          </Show>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 class="section-title">{m.trips_packing()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PackingList trip={t()} canUseTemplates={props.canOwnEquipment} onChanged={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 class="section-title">{m.trips_report()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent class="grid gap-3">
          <Show
            when={t().reportHtml}
            fallback={<p class="text-sm text-muted-foreground">{m.trips_report_empty()}</p>}
          >
            <div
              class="prose prose-sm max-w-none break-words"
              data-testid="trip-report"
              innerHTML={t().reportHtml}
            />
          </Show>
          <Show when={t().visits.length > 0}>
            <h3 class="kicker">{m.trips_visits()}</h3>
            <ul class="grid gap-1 text-sm">
              <For each={t().visits}>
                {(v) => (
                  <li>
                    <span class="font-mono text-xs text-muted-foreground">
                      {formatIsoDay(v.visitedOn)}
                    </span>{" "}
                    ·{" "}
                    <Show when={v.location} fallback={m.visit_location_unknown()}>
                      {(loc) => (
                        <Link
                          to="/locations/$locationId"
                          params={{ locationId: loc().id }}
                          class="text-primary underline underline-offset-4"
                        >
                          {loc().name}
                        </Link>
                      )}
                    </Show>{" "}
                    · {v.authorName}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
