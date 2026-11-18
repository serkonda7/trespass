import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  VisitForm,
  type VisitFormValues,
  valuesFromVisit,
  visitPayload,
} from "~/components/visits/visit-form";
import { locationQuery, principalsQuery } from "~/lib/locations/queries";
import type { PrincipalOption } from "~/lib/locations/types";
import { runAction } from "~/lib/run-action";
import { parseVisitsError } from "~/lib/visits/errors";
import { visitQuery } from "~/lib/visits/queries";
import type { SerializedVisit } from "~/lib/visits/types";
import { m } from "~/paraglide/messages";
import { updateVisitFn } from "~/server/visits/functions";

export const Route = createFileRoute("/_authed/visits/$visitId/edit")({
  beforeLoad: ({ params }) => {
    if (params.visitId.length > 64) throw notFound();
  },
  loader: async ({ context, params }) => {
    const visit = await context.queryClient
      .ensureQueryData(visitQuery(params.visitId))
      .catch((err: unknown) => {
        if (parseVisitsError(err).code === "VISIT_NOT_FOUND") throw notFound();
        throw err;
      });
    await context.queryClient.ensureQueryData(principalsQuery());
    if (visit.location) await context.queryClient.ensureQueryData(locationQuery(visit.location.id));
    return visit;
  },
  head: () => ({ meta: [{ title: `${m.visit_edit_title()} · ${m.app_name()}` }] }),
  component: EditVisitPage,
});

function EditVisitPage() {
  const params = Route.useParams();
  const q = useQuery(() => visitQuery(params().visitId));
  const principals = useQuery(() => principalsQuery());
  const location = useQuery(() => ({
    ...locationQuery(q.data?.location?.id ?? ""),
    enabled: Boolean(q.data?.location?.id),
  }));
  return (
    <div class="mx-auto max-w-3xl">
      <Show when={q.data} fallback={<Card class="p-6">{m.common_loading()}</Card>}>
        {(visit) => (
          <EditForm
            visit={visit()}
            principals={principals.data ?? []}
            shared={location.data?.location.visibility === "friends"}
          />
        )}
      </Show>
    </div>
  );
}

function EditForm(props: {
  visit: SerializedVisit;
  principals: readonly PrincipalOption[];
  shared: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [version, setVersion] = createSignal(props.visit.version);
  const [conflict, setConflict] = createSignal(false);
  const [initial, setInitial] = createSignal<VisitFormValues>(valuesFromVisit(props.visit));

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ["visits", "detail", props.visit.id] });
    const latest = await qc.fetchQuery(visitQuery(props.visit.id));
    setVersion(latest.version);
    setInitial(valuesFromVisit(latest));
    setConflict(false);
  };

  const onSubmit = async (values: VisitFormValues) => {
    const result = await runAction(
      () =>
        updateVisitFn({
          data: { id: props.visit.id, version: version(), ...visitPayload(values) },
        }),
      {
        success: m.visits_updated(),
        onError: (err) => {
          if (parseVisitsError(err).code === "VERSION_CONFLICT") {
            setConflict(true);
            void reload();
            return true;
          }
          return false;
        },
      },
    );
    if (!result) return false;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["visits"] }),
      qc.invalidateQueries({ queryKey: ["locations"] }),
    ]);
    if (props.visit.location) {
      await navigate({
        to: "/locations/$locationId",
        params: { locationId: props.visit.location.id },
      });
    } else {
      await navigate({ to: "/logbuch" });
    }
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 class="text-2xl font-semibold">{m.visit_edit_title()}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Show when={initial()} keyed>
          {(values) => (
            <VisitForm
              initial={values}
              principals={props.principals}
              shared={props.shared}
              visitId={props.visit.id}
              submitLabel={m.common_save()}
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
