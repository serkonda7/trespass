import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { formatCents, formatDateTime } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import type { ResearchRunDto } from "@trespass/shared/research/types";
import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { runKindLabel, runReasonLabel, runStatusLabel } from "~/lib/research/labels";
import { researchOverviewQuery } from "~/lib/research/queries";

export const Route = createFileRoute("/_authed/recherche/laeufe")({
  loader: ({ context }) => context.queryClient.ensureQueryData(researchOverviewQuery()),
  head: () => ({ meta: [{ title: `${m.research_tab_runs()} · ${m.app_name()}` }] }),
  component: RunsPage,
});

function RunsPage() {
  const data = useQuery(() => ({ ...researchOverviewQuery(), refetchInterval: 10_000 }));
  const budget = () => data.data?.budget;
  return (
    <div class="grid gap-4">
      <Show when={budget()}>
        {(b) => (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{m.research_budget_title({ month: b().month })}</h2>
              </CardTitle>
              <CardDescription>
                {m.research_budget_usage({
                  spent: formatCents(b().spentCents),
                  limit: formatCents(b().limitCents),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent class="grid gap-2 text-sm">
              <Show when={b().limitCents > 0}>
                <div
                  class="h-2 overflow-hidden rounded bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={b().limitCents}
                  aria-valuenow={Math.min(b().spentCents, b().limitCents)}
                  aria-label={m.research_budget_title({ month: b().month })}
                >
                  <div
                    class="h-full bg-primary"
                    style={{ width: `${Math.min(100, (b().spentCents / b().limitCents) * 100)}%` }}
                  />
                </div>
              </Show>
              <Show when={!b().enabled}>
                <p class="text-destructive">{m.research_disabled()}</p>
              </Show>
              <Show when={b().limitCents === 0}>
                <p>
                  {m.research_budget_none()}{" "}
                  <Link to="/admin/settings" class="text-primary underline underline-offset-4">
                    {m.admin_nav_settings()}
                  </Link>
                </p>
              </Show>
              <Show when={b().limitCents > 0 && b().spentCents >= b().limitCents}>
                <p class="text-destructive">{m.research_budget_reached()}</p>
              </Show>
              <Show when={!b().llmConfigured}>
                <p>{m.research_llm_missing()}</p>
              </Show>
              <Show when={!b().webSearchConfigured}>
                <p>{m.research_search_missing()}</p>
              </Show>
              <p class="text-muted-foreground">{m.research_watch_hint()}</p>
            </CardContent>
          </Card>
        )}
      </Show>
      <h2 class="text-lg font-semibold">{m.research_runs()}</h2>
      <Show
        when={(data.data?.runs.length ?? 0) > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.research_runs_empty()}</p>}
      >
        <ul class="grid gap-3" aria-label={m.research_runs()}>
          <For each={data.data?.runs}>{(run) => <RunCard run={run} />}</For>
        </ul>
      </Show>
    </div>
  );
}

function RunStats(props: { run: ResearchRunDto }) {
  const s = () => props.run.stats;
  const n = (v: number | undefined) => v ?? 0;
  return (
    <Show
      when={props.run.kind === "scan.overpass" || props.run.kind === "scan.wikidata"}
      fallback={
        <Show
          when={props.run.kind === "watch"}
          fallback={
            <span>
              {m.research_run_web_stats({
                pages: n(s().pages),
                facts: n(s().facts),
                dropped: n(s().dropped),
              })}
            </span>
          }
        >
          <span>{m.research_run_watch_stats({ locations: n(s().locations) })}</span>
        </Show>
      }
    >
      <span>
        {m.research_run_scan_stats({
          found: n(s().found),
          created: n(s().created),
          duplicates: n(s().duplicates),
          known: n(s().known),
        })}
      </span>
    </Show>
  );
}

function RunCard(props: { run: ResearchRunDto }) {
  const r = () => props.run;
  const tone = () =>
    r().status === "failed" ? "destructive" : r().status === "done" ? "secondary" : "outline";
  return (
    <li>
      <Card>
        <CardContent class="grid gap-2 pt-4 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{runKindLabel(r().kind)}</span>
            <Show when={r().area}>{(a) => <span>· {a().name}</span>}</Show>
            <Show when={r().location}>
              {(l) => (
                <Link
                  to="/locations/$locationId"
                  params={{ locationId: l().id }}
                  class="text-primary underline underline-offset-4"
                >
                  {l().name}
                </Link>
              )}
            </Show>
            <Badge variant={tone()} class="ml-auto">
              {runStatusLabel(r().status)}
            </Badge>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>{formatDateTime(r().createdAt)}</span>
            <Show when={r().status !== "pending"}>
              <RunStats run={r()} />
            </Show>
            <Show when={r().costCents > 0}>
              <span>{m.research_run_cost({ cost: formatCents(r().costCents) })}</span>
            </Show>
            <Show when={r().stats.reason}>
              {(reason) => <span>{runReasonLabel(reason())}</span>}
            </Show>
          </div>
          <Show when={r().error}>{(e) => <p class="break-words text-destructive">{e()}</p>}</Show>
          <Show when={r().summary}>
            {(s) => (
              <details>
                <summary class="cursor-pointer font-medium">{m.research_run_summary()}</summary>
                <p class="mt-1 whitespace-pre-line">{s()}</p>
              </details>
            )}
          </Show>
        </CardContent>
      </Card>
    </li>
  );
}
