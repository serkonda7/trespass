import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/solid-router";
import { deleteLocationFn, moveLocationFn } from "@trespass/server/locations/functions";
import { startEnrichFn } from "@trespass/server/research/functions";
import { can } from "@trespass/shared/app-actions";
import { formatCoordinates, parseCoordinates } from "@trespass/shared/geo/parse-coords";
import { parseLocationsError } from "@trespass/shared/locations/errors";
import type { SerializedLocation } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { photoUrl } from "@trespass/shared/photos/rules";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { CommentThread } from "~/components/comments/comment-thread";
import { ConfirmButton } from "~/components/confirm-dialog";
import { HistorySection } from "~/components/history/history-section";
import { EmptyState } from "~/components/layout/page-header";
import { CategoryIcon } from "~/components/locations/category-icon";
import { LocationSharing } from "~/components/locations/location-sharing";
import { StatusBadge } from "~/components/locations/status-badge";
import { MapView } from "~/components/map/map-view";
import { PhotoSection } from "~/components/photos/photo-section";
import { AddToTripDialog } from "~/components/trips/add-to-trip";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  IconAlertTriangle,
  IconArrowsMove,
  IconCar,
  IconCopy,
  IconExternalLink,
  IconKey,
  IconPencil,
  IconRoute,
  IconShare,
  IconTelescope,
  IconTrash,
} from "~/components/ui/icons";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { showToast } from "~/components/ui/toast";
import { LocationTimeline } from "~/components/visits/location-timeline";
import { cn } from "~/lib/cn";
import { locationQuery } from "~/lib/locations/queries";
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
    <EmptyState class="mx-auto max-w-lg">
      <h1 class="section-title mb-2 text-foreground">{m.locations_error_not_found()}</h1>
      <Link to="/map" class="text-primary underline underline-offset-4">
        {m.error_back_home()}
      </Link>
    </EmptyState>
  ),
  head: () => ({ meta: [{ title: `${m.nav_map()} · ${m.app_name()}` }] }),
  component: LocationPage,
});

/** Hand-off links always use the exact point. */
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
    <Show
      when={q.data}
      fallback={<EmptyState class="mx-auto max-w-lg">{m.common_loading()}</EmptyState>}
    >
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
    if (r) await navigate({ to: "/map", replace: true });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(formatCoordinates(loc().point));
    showToast({ title: m.location_copied(), variant: "success" });
  };

  const mapPreview = (cls: string) => (
    <div class={cls}>
      <MapView
        points={[
          {
            id: loc().id,
            name: loc().name,
            status: loc().status,
            categoryIcon: loc().category?.icon ?? "",
            lat: loc().point.lat,
            lon: loc().point.lon,
          },
        ]}
        marker={loc().point}
        center={{ point: loc().point, zoom: 13 }}
        label={loc().name}
        class="size-full"
      />
    </div>
  );

  /** Toolbar button: icon always, text from `sm` (still the accessible name). */
  const toolLabel = (text: string) => <span class="sr-only sm:not-sr-only">{text}</span>;

  return (
    <div class="mx-auto grid w-full max-w-4xl gap-5">
      <section class="overflow-hidden rounded-xl border bg-card" aria-labelledby="location-title">
        <Show when={loc().coverPhotoId} fallback={mapPreview("grid-paper h-56 border-b sm:h-72")}>
          {(id) => (
            <div class="relative h-56 border-b sm:h-80">
              <img
                src={photoUrl(id(), 1600)}
                alt={m.photos_cover()}
                class="size-full object-cover"
                data-testid="location-cover-photo"
              />
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent"
                aria-hidden="true"
              />
            </div>
          )}
        </Show>
        <div class="grid gap-3 p-4 sm:p-5">
          <p class="kicker flex flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryIcon name={loc().category?.icon} class="size-3.5 text-primary" />
            <For each={[loc().category?.name, loc().country, loc().adminArea].filter(Boolean)}>
              {(part, i) => (
                <>
                  <Show when={i() > 0}>
                    <span aria-hidden="true">·</span>
                  </Show>
                  <span>{part}</span>
                </>
              )}
            </For>
            <Show when={localTime()}>
              <span aria-hidden="true">·</span>
              <span>{m.location_local_time({ time: localTime()! })}</span>
            </Show>
          </p>
          <h1 id="location-title" class="page-title text-3xl sm:text-4xl">
            {loc().name}
          </h1>
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge status={loc().status} />
          </div>

          <section
            class="mt-1 flex flex-wrap items-center gap-2 border-t pt-4 [&>button]:flex-1 sm:[&>button]:flex-none"
            aria-label={m.location_details()}
          >
            <Show when={can({ role: props.role }, "createTrip")}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTripOpen(true)}
                data-testid="add-to-trip"
              >
                <IconRoute />
                {m.trips_add_to()}
              </Button>
            </Show>
            <Show when={can({ role: props.role }, "research")}>
              <Button
                variant="outline"
                size="sm"
                data-testid="start-research"
                onClick={() =>
                  void runAction(() => startEnrichFn({ data: { locationId: loc().id } }), {
                    success: m.research_started(),
                  })
                }
              >
                <IconTelescope />
                {m.research_start()}
              </Button>
            </Show>
            <div class="grid w-full auto-cols-fr grid-flow-col gap-2 empty:hidden sm:ml-auto sm:flex sm:w-auto">
              <Show when={loc().permissions.canEdit}>
                <Link
                  to="/locations/$locationId/edit"
                  params={{ locationId: loc().id }}
                  class={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <IconPencil />
                  {toolLabel(m.location_action_edit())}
                </Link>
                <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
                  <IconArrowsMove />
                  {toolLabel(m.location_action_move())}
                </Button>
              </Show>
              <Show when={loc().permissions.canManage}>
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  <IconShare />
                  {toolLabel(m.location_action_share())}
                </Button>
                <ConfirmButton
                  label={m.location_action_delete()}
                  question={m.location_delete_confirm()}
                  confirmLabel={m.location_action_delete()}
                  destructive
                  variant="destructive"
                  onConfirm={onDelete}
                >
                  <IconTrash />
                  {toolLabel(m.location_action_delete())}
                </ConfirmButton>
              </Show>
            </div>
          </section>
        </div>
      </section>

      {/* min-w-0: the grid item must not grow to the tab list's width on phones. */}
      <Tabs defaultValue="overview" class="min-w-0">
        <TabsList class="flex w-full justify-start overflow-x-auto [scrollbar-width:none]">
          <TabsTrigger value="overview">{m.location_tab_overview()}</TabsTrigger>
          <TabsTrigger value="visits">{m.location_tab_visits()}</TabsTrigger>
          <TabsTrigger value="photos">{m.location_tab_photos()}</TabsTrigger>
          <TabsTrigger value="history">{m.location_tab_history()}</TabsTrigger>
          <TabsTrigger value="comments">{m.location_tab_comments()}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div class="grid content-start gap-4">
              <Card>
                <CardContent class="grid gap-4 pt-4">
                  <p
                    class={cn(
                      "whitespace-pre-wrap leading-relaxed",
                      !loc().description && "text-muted-foreground",
                    )}
                  >
                    {loc().description || m.location_description_empty()}
                  </p>
                  <Show when={(loc().tags?.length ?? 0) > 0}>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="sr-only">{m.location_tags()}:</span>
                      <For each={loc().tags ?? []}>
                        {(tag) => <Badge variant="outline">#{tag}</Badge>}
                      </For>
                    </div>
                  </Show>
                </CardContent>
              </Card>
              <dl class="grid gap-3">
                <Show when={loc().dangerNotes}>
                  <Note
                    icon={<IconAlertTriangle />}
                    title={m.location_danger_notes()}
                    tone="warning"
                  >
                    {loc().dangerNotes}
                  </Note>
                </Show>
                <Show when={loc().accessNotes}>
                  <Note icon={<IconKey />} title={m.location_access_notes()}>
                    {loc().accessNotes}
                  </Note>
                </Show>
                <Show when={loc().parking?.length}>
                  <Note icon={<IconCar />} title={m.location_parking()}>
                    <span class="grid gap-1 font-mono text-sm">
                      <For each={loc().parking ?? []}>
                        {(p) => <span>{formatCoordinates(p)}</span>}
                      </For>
                    </span>
                  </Note>
                </Show>
              </dl>
            </div>

            <div class="grid content-start gap-4">
              <Show when={loc().coverPhotoId}>
                {mapPreview("grid-paper h-48 overflow-hidden rounded-lg border")}
              </Show>
              <section
                class="grid gap-3 rounded-lg border bg-card p-4"
                aria-label={m.location_coordinates()}
              >
                <h2 class="kicker">{m.location_coordinates()}</h2>
                <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border border-dashed bg-background px-3 py-2">
                  <code
                    class="whitespace-nowrap text-sm text-foreground"
                    data-testid="location-coordinates"
                  >
                    {formatCoordinates(loc().point)}
                  </code>
                  <Button variant="ghost" size="sm" class="-mr-1.5" onClick={copy}>
                    <IconCopy />
                    {m.location_copy()}
                  </Button>
                </div>
                <h3 class="kicker mt-1">{m.location_open_in()}</h3>
                <ul class="grid gap-1.5">
                  <For each={openLinks(loc().point)}>
                    {(link) => (
                      <li>
                        <a
                          class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-accent"
                          href={link.href}
                          rel="noopener noreferrer"
                        >
                          {m.location_open_in_app({ app: link.name })}
                          <IconExternalLink class="size-3.5 opacity-70" />
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="text-xs text-muted-foreground">{m.location_external_notice()}</p>
              </section>
            </div>
          </div>
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

/** One field note (danger, access, parking) with an icon and a title. */
function Note(props: {
  icon: JSX.Element;
  title: string;
  tone?: "warning";
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        "flex gap-3 rounded-lg border bg-card p-4",
        props.tone === "warning" && "border-warning/50 bg-warning/5",
      )}
    >
      <span
        class={cn(
          "mt-0.5 shrink-0 [&_svg]:size-4",
          props.tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {props.icon}
      </span>
      <div class="grid min-w-0 gap-1">
        <dt class={cn("kicker", props.tone === "warning" && "text-warning")}>{props.title}</dt>
        <dd class="whitespace-pre-wrap">{props.children}</dd>
      </div>
    </div>
  );
}
