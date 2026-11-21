import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/solid-router";
import { createLocationFn, findDuplicatesFn } from "@trespass/server/locations/functions";
import { parseCoordinates } from "@trespass/shared/geo/parse-coords";
import type { DuplicateMatch } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  emptyLocationValues,
  formPayload,
  LocationForm,
  type LocationFormValues,
} from "~/components/locations/location-form";
import { LazyMapView } from "~/components/map/lazy-map-view";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { categoriesQuery } from "~/lib/locations/queries";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/locations/new")({
  beforeLoad: ({ context }) => {
    if (context.user.role === "guest") throw notFound();
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(categoriesQuery()),
  head: () => ({ meta: [{ title: `${m.location_new_title()} · ${m.app_name()}` }] }),
  component: NewLocationPage,
});

function NewLocationPage() {
  const navigate = useNavigate();
  const categories = useQuery(() => categoriesQuery());
  const [name, setName] = createSignal("");
  const [coordText, setCoordText] = createSignal("");
  const [pick, setPick] = createSignal<{
    point: { lat: number; lon: number };
    nonce: number;
  } | null>(null);
  const [duplicates, setDuplicates] = createSignal<DuplicateMatch[]>([]);
  let dupTimer: ReturnType<typeof setTimeout> | undefined;
  let dupSeq = 0;
  onCleanup(() => clearTimeout(dupTimer));

  createEffect(() => {
    const n = name().trim();
    const p = parseCoordinates(coordText());
    clearTimeout(dupTimer);
    if (!n || !p) {
      setDuplicates([]);
      return;
    }
    const seq = ++dupSeq;
    dupTimer = setTimeout(async () => {
      const found = await runAction(() => findDuplicatesFn({ data: { name: n, point: p } }));
      if (seq === dupSeq) setDuplicates(found ?? []);
    }, 350);
  });

  const initial = () => emptyLocationValues(categories.data ?? []);

  const onSubmit = async (values: LocationFormValues): Promise<boolean> => {
    const payload = formPayload(values);
    if (!payload.name || !payload.point) return false;
    const result = await runAction(
      () =>
        createLocationFn({
          data: {
            ...payload,
            point: payload.point!,
            visibility: values.visibility,
            friendsLevel: values.friendsLevel,
          },
        }),
      { success: m.location_created() },
    );
    if (!result) return false;
    await navigate({ to: "/locations/$locationId", params: { locationId: result.id } });
    return true;
  };

  return (
    <div class="mx-auto grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 class="page-title">{m.location_new_title()}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LocationForm
            mode="create"
            initial={initial()}
            categories={categories.data ?? []}
            submitLabel={m.location_new_title()}
            pick={pick()}
            onValuesChange={(v) => {
              setName(v.name);
              setCoordText(v.coordText);
            }}
            onSubmit={onSubmit}
            extra={
              <Show when={duplicates().length > 0}>
                <section
                  class="rounded-md border border-accent p-3"
                  aria-label={m.location_duplicates_title()}
                >
                  <h2 class="font-semibold">{m.location_duplicates_title()}</h2>
                  <p class="text-sm text-muted-foreground">{m.location_duplicates_hint()}</p>
                  <ul class="mt-2 grid gap-1 text-sm">
                    <For each={duplicates()}>
                      {(d) => (
                        <li>
                          <Link
                            to="/locations/$locationId"
                            params={{ locationId: d.id }}
                            class="text-primary underline underline-offset-4"
                          >
                            {d.name}
                          </Link>{" "}
                          <span class="text-muted-foreground">
                            {d.reason === "nearby"
                              ? m.location_duplicate_nearby()
                              : m.location_duplicate_similar()}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
            }
          />
        </CardContent>
      </Card>

      <section aria-label={m.location_pick_hint()}>
        <p class="mb-2 text-sm text-muted-foreground">{m.location_pick_hint()}</p>
        <div class="h-72 overflow-hidden rounded-md border">
          <LazyMapView
            onPick={(point) => setPick({ point, nonce: Date.now() })}
            marker={parseCoordinates(coordText())}
            label={m.location_pick_hint()}
            class="size-full"
          />
        </div>
      </section>
    </div>
  );
}
