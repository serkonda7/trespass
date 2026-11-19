import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/solid-router";
import { deleteLocationFn, moveLocationFn } from "@trespass/server/locations/functions";
import { can } from "@trespass/shared/app-actions";
import { formatCoordinates, parseCoordinates } from "@trespass/shared/geo/parse-coords";
import { parseLocationsError } from "@trespass/shared/locations/errors";
import type { SerializedLocation } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { photoUrl } from "@trespass/shared/photos/rules";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CommentThread } from "~/components/comments/comment-thread";
import { ConfirmButton } from "~/components/confirm-dialog";
import { HistorySection } from "~/components/history/history-section";
import { LocationSharing } from "~/components/locations/location-sharing";
import { MapView } from "~/components/map/map-view";
import { PhotoSection } from "~/components/photos/photo-section";
import { AddToTripDialog } from "~/components/trips/add-to-trip";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { showToast } from "~/components/ui/toast";
import { LocationTimeline } from "~/components/visits/location-timeline";
import { settingsQuery } from "~/lib/admin-queries";
import { locationQuery } from "~/lib/locations/queries";
import { statusColor, statusLabel } from "~/lib/locations/status";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/locations/$locationId/")({
  beforeLoad: ({ params }) => {
    if (params.locationId.length > 64) throw notFound();
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(locationQuery(params.locationId)).catch((err: unknown) => {
      if (parseLocationsError(err).code === "LOCATION_NOT_FOUND") throw notFound();
      throw err;
    }),
  notFoundComponent: () => (
    <Card class="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 class="text-2xl font-semibold">{m.locations_error_not_found()}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Link to="/" class="text-primary underline underline-offset-4">
          {m.error_back_home()}
        </Link>
      </CardContent>
    </Card>
  ),
  head: () => ({ meta: [{ title: `${m.nav_map()} · ${m.app_name()}` }] }),
  component: LocationPage,
});

/** Maps only get exact coordinates when the server says `exact`. */
function openLinks(point: { lat: number; lon: number }) {
  const lat = String(point.lat);
  const lon = String(point.lon);
  return [
    { name: "OsmAnd", href: `https://osmand.net/map?pin=${lat},${lon}` },
    { name: "Organic Maps", href: `om://map?ll=${lat},${lon}` },
    { name: "Google Maps", href: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` },
    { name: "geo:", href: `geo:${lat},${lon}` },
  ];
}

function LocationPage() {
  const params = Route.useParams();
  const ctx = Route.useRouteContext();
  const q = useQuery(() => locationQuery(params().locationId));
  return (
    <Show when={q.data} fallback={<Card class="mx-auto max-w-lg p-6">{m.common_loading()}</Card>}>
      {(data) => (
        <LocationView
          location={data().location}
          meId={ctx().user.id}
          role={ctx().user.role}
          canAddVisit={data().location.permissions.canContribute && ctx().user.role !== "guest"}
        />
      )}
    </Show>
  );
}

function LocationView(props: {
  location: SerializedLocation;
  meId: string;
  role: "admin" | "member" | "guest";
  canAddVisit: boolean;
}) {
  const loc = () => props.location;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery(() => settingsQuery());
  const [shareOpen, setShareOpen] = createSignal(false);
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [tripOpen, setTripOpen] = createSignal(false);
  const [coordText, setCoordText] = createSignal(formatCoordinates(loc().point));
  const [localTime, setLocalTime] = createSignal<string | null>(null);
  onMount(() => {
    const tick = () =>
      setLocalTime(
        new Intl.DateTimeFormat("de-DE", {
          timeZone: loc().tz,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date()),
      );
    tick();
    const timer = setInterval(tick, 60_000);
    onCleanup(() => clearInterval(timer));
  });

  const point = () => parseCoordinates(coordText()) ?? loc().point;
  const exact = () => loc().exact;
  const refresh = () => qc.invalidateQueries({ queryKey: ["locations", "detail", loc().id] });

  const onMove = async () => {
    const next = parseCoordinates(coordText());
    if (!next) return;
    const r = await runAction(
      () => moveLocationFn({ data: { id: loc().id, version: loc().version, point: next } }),
      { success: m.location_moved() },
    );
    if (r) {
      setMoveOpen(false);
      await refresh();
    }
  };

  const onDelete = async () => {
    const r = await runAction(
      () => deleteLocationFn({ data: { id: loc().id, version: loc().version } }),
      { success: m.location_deleted() },
    );
    if (r) await navigate({ to: "/", replace: true });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(formatCoordinates(loc().point));
    showToast({ title: m.location_copied(), variant: "success" });
  };

  return (
    <div class="mx-auto grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-center gap-2">
            <CardTitle>
              <h1 class="text-2xl font-semibold">{loc().name}</h1>
            </CardTitle>
            <Badge style={{ "background-color": statusColor(loc().status), color: "#0f1216" }}>
              {statusLabel(loc().status)}
            </Badge>
            <Show when={!exact()}>
              <Badge variant="secondary">{m.location_approximate()}</Badge>
            </Show>
          </div>
          <p class="text-sm text-muted-foreground">
            {[loc().category?.name, loc().country, loc().adminArea].filter(Boolean).join(" · ")}
            <Show when={localTime()}> · {m.location_local_time({ time: localTime()! })}</Show>
          </p>
          <Show when={loc().coverPhotoId}>
            {(id) => (
              <img
                src={photoUrl(id(), 1600)}
                alt={m.photos_cover()}
                class="max-h-64 w-full rounded-md object-cover"
                data-testid="location-cover-photo"
              />
            )}
          </Show>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div class="h-64 overflow-hidden rounded-md border">
            <MapView
              points={[
                {
                  id: loc().id,
                  name: loc().name,
                  status: loc().status,
                  categoryIcon: loc().category?.icon ?? "",
                  exact: exact(),
                  lat: loc().point.lat,
                  lon: loc().point.lon,
                },
              ]}
              marker={loc().point}
              circle={
                exact() || !loc().fuzzRadiusM
                  ? null
                  : {
                      point: loc().point,
                      radiusM: loc().fuzzRadiusM ?? settings.data?.defaultFuzzM ?? 1500,
                    }
              }
              label={loc().name}
              class="size-full"
            />
          </div>
          <Show when={!exact()}>
            <p class="rounded-md border border-accent p-3 text-sm">
              <strong>{m.location_approximate()}</strong> — {m.location_approximate_hint()}
            </p>
          </Show>
        </CardContent>
      </Card>

      {/* min-w-0: the grid item must not grow to the tab list's width on phones. */}
      <Tabs defaultValue="overview" class="min-w-0">
        <TabsList class="flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{m.location_tab_overview()}</TabsTrigger>
          <TabsTrigger value="visits">{m.location_tab_visits()}</TabsTrigger>
          <TabsTrigger value="photos">{m.location_tab_photos()}</TabsTrigger>
          <TabsTrigger value="history">{m.location_tab_history()}</TabsTrigger>
          <TabsTrigger value="comments">{m.location_tab_comments()}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent class="grid gap-4 pt-4">
              <p class="whitespace-pre-wrap">
                {loc().description || m.location_description_empty()}
              </p>
              <Show when={exact()}>
                <dl class="grid gap-3 sm:grid-cols-2">
                  <Show when={loc().accessNotes}>
                    <div>
                      <dt class="font-semibold">{m.location_access_notes()}</dt>
                      <dd class="whitespace-pre-wrap">{loc().accessNotes}</dd>
                    </div>
                  </Show>
                  <Show when={loc().dangerNotes}>
                    <div>
                      <dt class="font-semibold">{m.location_danger_notes()}</dt>
                      <dd class="whitespace-pre-wrap">{loc().dangerNotes}</dd>
                    </div>
                  </Show>
                  <Show when={loc().parking?.length}>
                    <div>
                      <dt class="font-semibold">{m.location_parking()}</dt>
                      <dd>
                        <For each={loc().parking ?? []}>
                          {(p, i) => (
                            <span>
                              {i() > 0 ? " · " : ""}
                              {formatCoordinates(p)}
                            </span>
                          )}
                        </For>
                      </dd>
                    </div>
                  </Show>
                </dl>
                <section class="grid gap-2" aria-label={m.location_coordinates()}>
                  <h2 class="font-semibold">{m.location_coordinates()}</h2>
                  <div class="flex flex-wrap items-center gap-2">
                    <code data-testid="location-coordinates">{formatCoordinates(loc().point)}</code>
                    <Button variant="outline" size="sm" onClick={copy}>
                      {m.location_copy()}
                    </Button>
                  </div>
                  <p class="text-sm text-muted-foreground">{m.location_external_notice()}</p>
                  <h3 class="font-semibold">{m.location_open_in()}</h3>
                  <ul class="flex flex-wrap gap-2">
                    <For each={openLinks(loc().point)}>
                      {(link) => (
                        <li>
                          <a
                            class="text-primary underline underline-offset-4"
                            href={link.href}
                            rel="noopener noreferrer"
                          >
                            {m.location_open_in_app({ app: link.name })}
                          </a>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
              <Show when={(loc().tags?.length ?? 0) > 0}>
                <p class="text-sm text-muted-foreground">
                  {m.location_tags()}: {(loc().tags ?? []).join(", ")}
                </p>
              </Show>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="visits">
          <LocationTimeline locationId={loc().id} tz={loc().tz} canAdd={props.canAddVisit} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotoSection
            locationId={loc().id}
            canContribute={props.canAddVisit}
            canSetCover={loc().permissions.canEdit}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistorySection
            locationId={loc().id}
            canEdit={loc().permissions.canEdit && props.role !== "guest"}
            shared={loc().visibility === "friends"}
          />
        </TabsContent>
        <TabsContent value="comments">
          <Card>
            <CardContent class="pt-4">
              <CommentThread
                target={{ kind: "location", id: loc().id }}
                shared={loc().visibility === "friends"}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <section class="flex flex-wrap gap-2" aria-label={m.location_details()}>
        <Show when={can({ role: props.role }, "createTrip")}>
          <Button variant="outline" onClick={() => setTripOpen(true)} data-testid="add-to-trip">
            {m.trips_add_to()}
          </Button>
        </Show>
        <Show when={loc().permissions.canEdit}>
          <Link
            to="/locations/$locationId/edit"
            params={{ locationId: loc().id }}
            class={buttonVariants({ variant: "outline" })}
          >
            {m.location_action_edit()}
          </Link>
          <Button variant="outline" onClick={() => setMoveOpen(true)}>
            {m.location_action_move()}
          </Button>
        </Show>
        <Show when={loc().permissions.canManage}>
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            {m.location_action_share()}
          </Button>
          <ConfirmButton
            label={m.location_action_delete()}
            question={m.location_delete_confirm()}
            confirmLabel={m.location_action_delete()}
            destructive
            variant="destructive"
            onConfirm={onDelete}
          />
        </Show>
      </section>

      <AddToTripDialog
        locationId={loc().id}
        isAdmin={props.role === "admin"}
        open={tripOpen()}
        onOpenChange={setTripOpen}
      />

      <LocationSharing
        location={loc()}
        open={shareOpen()}
        onOpenChange={setShareOpen}
        meId={props.meId}
      />

      <Dialog open={moveOpen()} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.location_move_title()}</DialogTitle>
            <DialogDescription>{m.location_coordinates_hint()}</DialogDescription>
          </DialogHeader>
          <div class="grid gap-2">
            <Label for="move-coords">{m.location_field_coordinates()}</Label>
            <Input
              id="move-coords"
              class={inputClass}
              value={coordText()}
              onInput={(e) => setCoordText(e.currentTarget.value)}
            />
            <div class="h-64 overflow-hidden rounded-md border">
              <MapView
                onPick={(p) => setCoordText(formatCoordinates(p))}
                marker={point()}
                label={m.location_pick_hint()}
                class="size-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              {m.common_cancel()}
            </Button>
            <Button onClick={onMove} disabled={!parseCoordinates(coordText())}>
              {m.common_save()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
