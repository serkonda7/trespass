import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { createTripFn } from "@trespass/server/trips/functions";
import { can } from "@trespass/shared/app-actions";
import { m } from "@trespass/shared/paraglide/messages";
import { Show } from "solid-js";
import {
  emptyTripValues,
  TripForm,
  type TripFormValues,
  tripPayload,
} from "~/components/trips/trip-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { locationQuery, principalsQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/touren/new")({
  validateSearch: (raw: Record<string, unknown>): { location?: string } =>
    typeof raw.location === "string" && raw.location && raw.location.length <= 64
      ? { location: raw.location }
      : {},
  beforeLoad: ({ context }) => {
    if (!can(context.user, "createTrip")) throw notFound();
  },
  loaderDeps: ({ search }) => ({ location: search.location }),
  loader: async ({ context, deps }) => {
    const location = deps.location;
    await Promise.all([
      context.queryClient.ensureQueryData(principalsQuery()),
      location
        ? context.queryClient.ensureQueryData(locationQuery(location)).catch(() => null)
        : null,
    ]);
  },
  head: () => ({ meta: [{ title: `${m.trips_new()} · ${m.app_name()}` }] }),
  component: NewTripPage,
});

function NewTripPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const principals = useQuery(() => principalsQuery());
  const location = useQuery(() => ({
    ...locationQuery(search().location ?? ""),
    enabled: Boolean(search().location),
  }));

  const onSubmit = async (values: TripFormValues) => {
    const stop = location.data?.location.id;
    const r = await runAction(
      () => createTripFn({ data: { ...tripPayload(values), locationIds: stop ? [stop] : [] } }),
      { success: m.trips_created() },
    );
    if (!r) return false;
    await qc.invalidateQueries({ queryKey: ["trips"] });
    await navigate({ to: "/touren/$tripId", params: { tripId: r.id } });
    return true;
  };

  return (
    <div class="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 class="page-title">{m.trips_new()}</h1>
          </CardTitle>
          <Show when={location.data}>
            {(data) => (
              <p class="text-sm text-muted-foreground">
                {m.trips_first_stop({ name: data().location.name })}
              </p>
            )}
          </Show>
        </CardHeader>
        <CardContent>
          <TripForm
            initial={emptyTripValues()}
            principals={principals.data ?? []}
            submitLabel={m.trips_create()}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
