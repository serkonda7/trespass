import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { candidateTitle } from "@trespass/shared/research/text";
import {
  CANDIDATE_KINDS,
  CANDIDATE_STATUSES,
  type CandidateStatus,
} from "@trespass/shared/research/types";
import { createMemo, For, Show } from "solid-js";
import { z } from "zod";
import { type MapBbox, type MapPoint, MapView } from "~/components/map/map-view";
import { CandidateCard } from "~/components/research/candidate-card";
import { Button } from "~/components/ui/button";
import { inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { candidateKindLabel } from "~/lib/research/labels";
import { candidatesQuery, researchAreasQuery } from "~/lib/research/queries";

const search = z.object({
  status: z.enum(CANDIDATE_STATUSES).optional().catch(undefined),
  kind: z.enum(CANDIDATE_KINDS).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/recherche/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureInfiniteQueryData(
        candidatesQuery({ status: deps.status ?? "inbox", kind: deps.kind }),
      ),
      context.queryClient.ensureQueryData(researchAreasQuery()),
    ]),
  head: () => ({ meta: [{ title: `${m.research_tab_inbox()} · ${m.app_name()}` }] }),
  component: InboxPage,
});

const STATUS_LABEL: Record<CandidateStatus, (p: { count: number }) => string> = {
  inbox: m.research_status_inbox,
  accepted: m.research_status_accepted,
  merged: m.research_status_merged,
  rejected: m.research_status_rejected,
};

function InboxPage() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: "/recherche/" });
  const qc = useQueryClient();
  const status = () => params().status ?? "inbox";
  const list = useInfiniteQuery(() => candidatesQuery({ status: status(), kind: params().kind }));
  const areas = useQuery(() => researchAreasQuery());
  const items = createMemo(() => list.data?.pages.flatMap((p) => p.items) ?? []);
  const counts = () => list.data?.pages[0]?.counts;
  const refresh = () => qc.invalidateQueries({ queryKey: ["research"] });

  const points = createMemo<MapPoint[]>(() =>
    items()
      .filter((c) => c.point)
      .map((c) => ({
        id: c.id,
        name: candidateTitle(c),
        status: "idea",
        categoryIcon: "?",
        exact: true,
        lat: c.point!.lat,
        lon: c.point!.lon,
      })),
  );
  const fit = createMemo<MapBbox | null>(() => {
    const p = points();
    if (p.length === 0) return null;
    const lats = p.map((x) => x.lat);
    const lons = p.map((x) => x.lon);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  });

  return (
    <div class="grid gap-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1">
          <Label for="inbox-status">{m.research_filter_status()}</Label>
          <select
            id="inbox-status"
            class={inputClass}
            value={status()}
            onChange={(e) =>
              navigate({
                search: (s) => ({ ...s, status: e.currentTarget.value as CandidateStatus }),
              })
            }
          >
            <For each={CANDIDATE_STATUSES}>
              {(s) => <option value={s}>{STATUS_LABEL[s]({ count: counts()?.[s] ?? 0 })}</option>}
            </For>
          </select>
        </div>
        <div class="grid gap-1">
          <Label for="inbox-kind">{m.research_filter_kind()}</Label>
          <select
            id="inbox-kind"
            class={inputClass}
            value={params().kind ?? ""}
            onChange={(e) =>
              navigate({
                search: (s) => ({
                  ...s,
                  kind: (e.currentTarget.value || undefined) as
                    | (typeof CANDIDATE_KINDS)[number]
                    | undefined,
                }),
              })
            }
          >
            <option value="">{m.research_kind_all()}</option>
            <For each={CANDIDATE_KINDS}>
              {(k) => <option value={k}>{candidateKindLabel(k)}</option>}
            </For>
          </select>
        </div>
      </div>

      <Show when={points().length > 0 || (areas.data?.length ?? 0) > 0}>
        <div class="h-72 overflow-hidden rounded-md border">
          <MapView
            label={m.research_map_label()}
            points={points()}
            polygons={(areas.data ?? []).map((a) => a.geom.coordinates[0] as [number, number][])}
            pinHref={(id) => `#candidate-${id}`}
            fit={fit()}
          />
        </div>
      </Show>

      <Show
        when={items().length > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.research_inbox_empty()}</p>}
      >
        <ul class="grid gap-3" aria-label={m.research_tab_inbox()}>
          <For each={items()}>{(c) => <CandidateCard candidate={c} onDecided={refresh} />}</For>
        </ul>
      </Show>
      <Show when={list.hasNextPage}>
        <Button
          variant="outline"
          class="justify-self-center"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {m.research_more()}
        </Button>
      </Show>
    </div>
  );
}
