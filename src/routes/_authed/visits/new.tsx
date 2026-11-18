import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  emptyVisitValues,
  VisitForm,
  type VisitFormValues,
  visitPayload,
} from "~/components/visits/visit-form";
import { todayInTz, tzOffsetLabel } from "~/lib/format";
import { parseLocationsError } from "~/lib/locations/errors";
import { locationQuery, principalsQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";
import { m } from "~/paraglide/messages";
import { createVisitFn } from "~/server/visits/functions";

export const Route = createFileRoute("/_authed/visits/new")({
  validateSearch: (raw: Record<string, unknown>) => ({
    location: typeof raw.location === "string" ? raw.location : "",
  }),
  beforeLoad: ({ context, search }) => {
    if (context.user.role === "guest" || !search.location || search.location.length > 64) {
      throw notFound();
    }
    return { locationId: search.location };
  },
  loader: async ({ context }) => {
    await context.queryClient
      .ensureQueryData(locationQuery(context.locationId))
      .catch((err: unknown) => {
        if (parseLocationsError(err).code === "LOCATION_NOT_FOUND") throw notFound();
        throw err;
      });
    await context.queryClient.ensureQueryData(principalsQuery());
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
      () => createVisitFn({ data: { locationId: search().location, ...visitPayload(values) } }),
      { success: m.visits_created() },
    );
    if (!result) return false;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["visits"] }),
      qc.invalidateQueries({ queryKey: ["locations"] }),
    ]);
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
