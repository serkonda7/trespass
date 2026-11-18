import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { guardSection } from "~/lib/admin-sections";
import { formatIsoDay, formatNumber } from "~/lib/format";
import { runAction } from "~/lib/run-action";
import { adminTilesQuery } from "~/lib/tiles/queries";
import { m } from "~/paraglide/messages";
import {
  deleteTileRegionFn,
  enqueueWorldTilesFn,
  refreshTileRegionFn,
} from "~/server/tiles/functions";
import type { AdminTileRegion } from "~/server/tiles/service";

export const Route = createFileRoute("/_authed/admin/tiles")({
  beforeLoad: ({ context }) => guardSection(context.user.role, "/admin/tiles"),
  loader: ({ context }) => context.queryClient.ensureQueryData(adminTilesQuery()),
  head: () => ({ meta: [{ title: `${m.admin_nav_tiles()} · ${m.app_name()}` }] }),
  component: TilesPage,
});

const STATUS: Record<string, () => string> = {
  pending: m.admin_tiles_status_pending,
  extracting: m.admin_tiles_status_extracting,
  ready: m.admin_tiles_status_ready,
  failed: m.admin_tiles_status_failed,
};

function TilesPage() {
  const qc = useQueryClient();
  const data = useQuery(() => adminTilesQuery());
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "tiles"] });
  const total = () => formatNumber(data.data?.totalMb ?? 0, 1);
  const budget = () => formatNumber(data.data?.budgetMb ?? 10240, 0);

  async function enqueue(fn: () => Promise<unknown>, success: string = m.admin_tiles_queued()) {
    const r = await runAction(fn, { success });
    if (r) await refresh();
  }

  return (
    <div class="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{m.admin_nav_tiles()}</h2>
          </CardTitle>
          <CardDescription>{m.admin_tiles_intro()}</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-3">
          <p class="text-sm text-muted-foreground">
            {m.admin_tiles_total({ size: total(), budget: budget() })}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void enqueue(() => enqueueWorldTilesFn())}>
              {m.admin_tiles_world()}
            </Button>
            <span class="text-sm text-muted-foreground">{m.admin_tiles_world_hint()}</span>
          </div>
        </CardContent>
      </Card>
      <Show
        when={(data.data?.regions ?? []).length > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.admin_tiles_empty()}</p>}
      >
        <ul class="grid gap-3" aria-label={m.admin_nav_tiles()}>
          <For each={data.data?.regions}>
            {(region) => <RegionCard region={region} enqueue={enqueue} refresh={refresh} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function RegionCard(props: {
  region: AdminTileRegion;
  enqueue: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const r = () => props.region;
  const status = () => (STATUS[r().status] ?? STATUS.pending!)();
  return (
    <li>
      <Card>
        <CardContent class="grid gap-2 pt-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-xs text-muted-foreground">{r().id.slice(0, 8)}</span>
            <Show when={r().kind === "world"}>
              <span class="rounded border px-2 py-0.5 text-xs">{m.admin_tiles_world_badge()}</span>
            </Show>
            <span class="ml-auto text-sm">{status()}</span>
          </div>
          <p class="text-sm">
            {m.admin_tiles_bbox({
              minLat: r().minLat,
              minLon: r().minLon,
              maxLat: r().maxLat,
              maxLon: r().maxLon,
            })}
          </p>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{m.admin_tiles_zoom({ min: r().minZoom, max: r().maxZoom })}</span>
            <span>{m.admin_tiles_size({ size: formatNumber(r().sizeMb, 1) })}</span>
            <Show when={r().buildDate}>
              {(date) => <span>{m.admin_tiles_build({ date: formatIsoDay(date()) })}</span>}
            </Show>
            <Show when={r().emptySince}>
              {(date) => <span>{m.admin_tiles_empty_since({ date: formatIsoDay(date()) })}</span>}
            </Show>
            <Show when={r().error === "budget"}>
              <span class="text-destructive">{m.admin_tiles_error_budget()}</span>
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void props.enqueue(() => refreshTileRegionFn({ data: { regionId: r().id } }))
              }
            >
              {m.admin_tiles_refresh()}
            </Button>
            <ConfirmButton
              label={m.admin_tiles_delete()}
              question={m.admin_tiles_delete_confirm({ id: r().id.slice(0, 8) })}
              destructive
              onConfirm={async () => {
                await props.enqueue(
                  () => deleteTileRegionFn({ data: { regionId: r().id } }),
                  m.admin_tiles_deleted(),
                );
              }}
            />
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
