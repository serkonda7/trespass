import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { createVisitFn } from "@trespass/server/visits/functions";
import { todayInTz, tzOffsetLabel } from "@trespass/shared/format";
import { parseLocationsError } from "@trespass/shared/locations/errors";
import { m } from "@trespass/shared/paraglide/messages";
import { Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  emptyVisitValues,
  VisitForm,
  type VisitFormValues,
  visitPayload,
} from "~/components/visits/visit-form";
import { allInOrder } from "~/lib/all-in-order";
import { locationQuery, principalsQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/visits/new")({
  validateSearch: (raw: Record<string, unknown>): { location: string; trip?: string } => ({
    location: typeof raw.location === "string" ? raw.location : "",
    /** Set when the visit is logged from a trip stop. */
    ...(typeof raw.trip === "string" && raw.trip.length <= 64 ? { trip: raw.trip } : {}),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.user.role === "guest" || !search.location || search.location.length > 64) {
      throw notFound();
    }
    return { locationId: search.location };
  },
  loader: async ({ context }) => {
    await allInOrder(
      context.queryClient
        .ensureQueryData(locationQuery(context.locationId))
        .catch((err: unknown) => {
          if (parseLocationsError(err).code === "LOCATION_NOT_FOUND") throw notFound();
          throw err;
        }),
      context.queryClient.ensureQueryData(principalsQuery()),
    );
  },
  head: () => ({ meta: [{ title: `${m.visit_new_title()} · ${m.app_name()}` }] }),
  component: NewVisitPage,
});

function NewVisitPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useQuery(() => locationQuery(search().location));
  const principals = useQuery(() => principalsQuery());

  const onSubmit = async (values: VisitFormValues) => {
    const result = await runAction(
      () =>
        createVisitFn({
          data: {
            locationId: search().location,
            ...visitPayload(values),
            ...(search().trip ? { tripId: search().trip } : {}),
          },
        }),
      { success: m.visits_created() },
    );
    if (!result) return false;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["visits"] }),
      qc.invalidateQueries({ queryKey: ["locations"] }),
      qc.invalidateQueries({ queryKey: ["trips"] }),
    ]);
    const trip = search().trip;
    if (trip) await navigate({ to: "/touren/$tripId", params: { tripId: trip } });
    else
      await navigate({ to: "/locations/$locationId", params: { locationId: search().location } });
    return true;
  };

  return (
    <div class="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 class="text-2xl font-semibold">{m.visit_new_title()}</h1>
          </CardTitle>
          <Show when={location.data}>
            {(data) => (
              <p class="text-sm text-muted-foreground">
                {data().location.name} · {m.visits_local_time()} (
                {tzOffsetLabel(data().location.tz)})
              </p>
            )}
          </Show>
        </CardHeader>
        <CardContent>
          <Show when={location.data} fallback={<p>{m.common_loading()}</p>}>
            {(data) => (
              <>
                <VisitForm
                  initial={emptyVisitValues(todayInTz(data().location.tz))}
                  principals={principals.data ?? []}
                  shared={data().location.visibility === "friends"}
                  submitLabel={m.visits_add()}
                  onSubmit={onSubmit}
                />
                <p class="pt-3 text-xs text-muted-foreground">{m.photos_upload_after_save()}</p>
              </>
            )}
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
