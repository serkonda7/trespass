import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { updateTripFn } from "@trespass/server/trips/functions";
import { errorCode } from "@trespass/shared/error-text";
import type { PrincipalOption } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import type { SerializedTrip } from "@trespass/shared/trips/types";
import { createSignal, Show } from "solid-js";
import {
  TripForm,
  type TripFormValues,
  tripPayload,
  valuesFromTrip,
} from "~/components/trips/trip-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { principalsQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";
import { tripQuery } from "~/lib/trips/queries";

export const Route = createFileRoute("/_authed/touren/$tripId/edit")({
  beforeLoad: ({ params }) => {
    if (params.tripId.length > 64) throw notFound();
  },
  loader: async ({ context, params }) => {
    // Both requests run at once; principals may fail with 403 for people who
    // cannot edit, so its outcome is only looked at after the trip checks.
    const principals = context.queryClient.ensureQueryData(principalsQuery());
    principals.catch(() => {});
    const trip = await context.queryClient
      .ensureQueryData(tripQuery(params.tripId))
      .catch((err: unknown) => {
        if (errorCode(err) === "TRIP_NOT_FOUND") throw notFound();
        throw err;
      });
    if (!trip.permissions.canEdit) throw notFound();
    await principals;
  },
  head: () => ({ meta: [{ title: `${m.trips_edit()} · ${m.app_name()}` }] }),
  component: EditTripPage,
});

function EditTripPage() {
  const params = Route.useParams();
  const q = useQuery(() => tripQuery(params().tripId));
  const principals = useQuery(() => principalsQuery());
  return (
    <div class="mx-auto max-w-3xl">
      <Show when={q.data} fallback={<Card class="p-6">{m.common_loading()}</Card>}>
        {(trip) => <EditForm trip={trip()} principals={principals.data ?? []} />}
      </Show>
    </div>
  );
}

function EditForm(props: { trip: SerializedTrip; principals: readonly PrincipalOption[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [version, setVersion] = createSignal(props.trip.version);
  const [conflict, setConflict] = createSignal(false);
  const [initial, setInitial] = createSignal<TripFormValues>(valuesFromTrip(props.trip));

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ["trips", "detail", props.trip.id] });
    const latest = await qc.fetchQuery(tripQuery(props.trip.id));
    setVersion(latest.version);
    setInitial(valuesFromTrip(latest));
    setConflict(false);
  };

  const onSubmit = async (values: TripFormValues) => {
    const r = await runAction(
      () =>
        updateTripFn({
          data: {
            id: props.trip.id,
            version: version(),
            ...tripPayload(values),
            status: values.status,
            reportMd: values.reportMd,
          },
        }),
      {
        success: m.trips_saved(),
        onError: (err) => {
          if (errorCode(err) === "VERSION_CONFLICT") {
            setConflict(true);
            return true;
          }
          return false;
        },
      },
    );
    if (!r) return false;
    await qc.invalidateQueries({ queryKey: ["trips"] });
    await navigate({ to: "/touren/$tripId", params: { tripId: props.trip.id } });
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 class="text-2xl font-semibold">{m.trips_edit()}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Show when={initial()} keyed>
          {(values) => (
            <TripForm
              initial={values}
              principals={props.principals}
              submitLabel={m.common_save()}
              editing
              conflict={conflict()}
              onReload={() => void reload()}
              onSubmit={onSubmit}
            />
          )}
        </Show>
      </CardContent>
    </Card>
  );
}
