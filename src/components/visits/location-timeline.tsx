// The "Besuche" tab on a location: visits and status changes in one list.
import { useQuery } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Card, CardContent } from "~/components/ui/card";
import { formatIsoDay } from "~/lib/format";
import { statusLabel } from "~/lib/locations/status";
import type { LocationStatus } from "~/lib/locations/types";
import { locationTimelineQuery } from "~/lib/visits/queries";
import type { TimelineEntry } from "~/lib/visits/types";
import { m } from "~/paraglide/messages";
import { VisitCard } from "./visit-card";

export function LocationTimeline(props: { locationId: string; tz: string; canAdd: boolean }) {
  const timeline = useQuery(() => locationTimelineQuery(props.locationId));
  const [reload, setReload] = createSignal(0);

  return (
    <div class="grid gap-3">
      <Show when={props.canAdd}>
        <div>
          <Link
            to="/visits/new"
            search={{ location: props.locationId }}
            class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            data-testid="add-visit"
          >
            {m.visits_add()}
          </Link>
        </div>
      </Show>
      <Show
        when={timeline.data?.length}
        fallback={
          <Card>
            <CardContent class="pt-4">{m.visits_empty()}</CardContent>
          </Card>
        }
      >
        <ol class="grid gap-3" data-reload={reload()}>
          <For each={timeline.data ?? []}>
            {(entry) => (
              <li>
                <TimelineItem
                  entry={entry}
                  tz={props.tz}
                  onChanged={() => setReload((n) => n + 1)}
                />
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}

function TimelineItem(props: { entry: TimelineEntry; tz: string; onChanged: () => void }) {
  return (
    <Switch>
      <Match when={props.entry.kind === "visit"}>
        {(() => {
          const entry = props.entry as Extract<TimelineEntry, { kind: "visit" }>;
          return <VisitCard visit={entry.visit} tz={props.tz} onChanged={props.onChanged} />;
        })()}
      </Match>
      <Match when={props.entry.kind === "status"}>
        {(() => {
          const entry = props.entry as Extract<TimelineEntry, { kind: "status" }>;
          return (
            <Card data-testid="status-change">
              <CardContent class="flex flex-wrap items-center gap-2 pt-4 text-sm">
                <strong>{formatIsoDay(entry.date)}</strong>
                <span>{m.visits_status_change()}</span>
                <span>
                  {m.logbook_status_change({
                    from: statusLabelSafe(entry.from),
                    to: statusLabelSafe(entry.to),
                  })}
                </span>
              </CardContent>
            </Card>
          );
        })()}
      </Match>
    </Switch>
  );
}

function statusLabelSafe(status: string | null): string {
  return status ? statusLabel(status as LocationStatus) : "–";
}
