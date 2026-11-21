import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { updateLocationFn } from "@trespass/server/locations/functions";
import { parseLocationsError } from "@trespass/shared/locations/errors";
import type { CategoryRow, SerializedLocation } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createSignal, Show } from "solid-js";
import {
  LocationForm,
  type LocationFormValues,
  valuesFromLocation,
} from "~/components/locations/location-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { allInOrder } from "~/lib/all-in-order";
import { categoriesQuery, locationQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/locations/$locationId/edit")({
  beforeLoad: ({ params }) => {
    if (params.locationId.length > 64) throw notFound();
  },
  loader: async ({ context, params }) => {
    const [location] = await allInOrder(
      context.queryClient
        .ensureQueryData(locationQuery(params.locationId))
        .catch((err: unknown) => {
          if (parseLocationsError(err).code === "LOCATION_NOT_FOUND") throw notFound();
          throw err;
        }),
      context.queryClient.ensureQueryData(categoriesQuery()),
    );
    return location;
  },
  head: () => ({ meta: [{ title: `${m.location_edit_title()} · ${m.app_name()}` }] }),
  component: EditLocationPage,
});

type Snapshot = { version: number; values: LocationFormValues };
const snapshotOf = (loc: SerializedLocation): Snapshot => ({
  version: loc.version,
  values: valuesFromLocation(loc),
});

function EditLocationPage() {
  const params = Route.useParams();
  const q = useQuery(() => locationQuery(params().locationId));
  const categories = useQuery(() => categoriesQuery());
  return (
    <div class="mx-auto max-w-3xl">
      <Show when={q.data} fallback={<Card class="p-6">{m.common_loading()}</Card>}>
        {(data) => <EditForm location={data().location} categories={categories.data ?? []} />}
      </Show>
    </div>
  );
}

function EditForm(props: { location: SerializedLocation; categories: readonly CategoryRow[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = createSignal<Snapshot>(snapshotOf(props.location));
  const [conflict, setConflict] = createSignal(false);

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ["locations", "detail", props.location.id] });
    const latest = await qc.fetchQuery(locationQuery(props.location.id));
    setSnapshot(snapshotOf(latest.location));
    setConflict(false);
  };

  const onSubmit = async (values: LocationFormValues): Promise<boolean> => {
    const r = await runAction(
      () =>
        updateLocationFn({
          data: {
            id: props.location.id,
            version: snapshot().version,
            name: values.name.trim(),
            categoryId: values.categoryId,
            status: values.status,
            description: values.description || null,
            accessNotes: values.accessNotes || null,
            dangerNotes: values.dangerNotes || null,
            builtYear: values.builtYear ? Number(values.builtYear) : null,
            abandonedYear: values.abandonedYear ? Number(values.abandonedYear) : null,
            tags: values.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          },
        }),
      {
        success: m.location_updated(),
        onError: (err) => {
          if (parseLocationsError(err).code === "VERSION_CONFLICT") {
            setConflict(true);
            void reload(); // like hausmeister's useItemWrite: show it, then reload
            return true;
          }
          return false;
        },
      },
    );
    if (!r) return false;
    await navigate({ to: "/locations/$locationId", params: { locationId: props.location.id } });
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 class="page-title">{m.location_edit_title()}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent class="grid gap-4">
        <Show when={conflict()}>
          <div
            class="rounded-md border border-destructive p-3"
            role="alert"
            data-testid="edit-conflict"
          >
            <p class="font-semibold">{m.location_conflict()}</p>
            <button
              type="button"
              class="mt-2 text-primary underline underline-offset-4"
              onClick={() => void reload()}
            >
              {m.location_conflict_reload()}
            </button>
          </div>
        </Show>
        <Show when={snapshot()} keyed>
          {(s) => (
            <LocationForm
              mode="edit"
              initial={s.values}
              categories={props.categories}
              submitLabel={m.common_save()}
              onSubmit={onSubmit}
            />
          )}
        </Show>
      </CardContent>
    </Card>
  );
}
