// The "Besuche" tab on a location: visits, history entries and status changes
// in one list, newest first.
import { useQuery } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { formatIsoDay } from "@trespass/shared/format";
import type { LocationStatus } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import type { TimelineEntry } from "@trespass/shared/visits/types";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { HistoryCard } from "~/components/history/history-section";
import { EmptyState } from "~/components/layout/page-header";
import { buttonVariants } from "~/components/ui/button";
import { IconPlus } from "~/components/ui/icons";
import { statusLabel } from "~/lib/locations/status";
import { locationTimelineQuery } from "~/lib/visits/queries";
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
            class={buttonVariants()}
            data-testid="add-visit"
          >
            <IconPlus />
            {m.visits_add()}
          </Link>
        </div>
      </Show>
      <Show when={timeline.data?.length} fallback={<EmptyState>{m.visits_empty()}</EmptyState>}>
        {/* A survey line down the left with a marker per entry. */}
        <ol
          class="relative grid gap-4 pl-6 before:absolute before:bottom-2 before:left-[0.4375rem] before:top-2 before:w-px before:bg-border"
          data-reload={reload()}
        >
          <For each={timeline.data ?? []}>
            {(entry) => (
              <li class="relative">
                <span
                  class={
                    entry.kind === "visit"
                      ? "absolute -left-6 top-5 size-3.5 rounded-full border-2 border-background bg-primary"
                      : "absolute -left-[1.3rem] top-5 size-2 rounded-full bg-muted-foreground"
                  }
                  aria-hidden="true"
                />
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
      <Match when={props.entry.kind === "history"}>
        {(() => {
          const entry = props.entry as Extract<TimelineEntry, { kind: "history" }>;
          return <HistoryCard entry={entry.history} />;
        })()}
      </Match>
      <Match when={props.entry.kind === "status"}>
        {(() => {
          const entry = props.entry as Extract<TimelineEntry, { kind: "status" }>;
          return (
            <div
              class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-4 py-3 text-sm"
              data-testid="status-change"
            >
              <span class="kicker text-foreground">{formatIsoDay(entry.date)}</span>
              <span class="text-muted-foreground">{m.visits_status_change()}</span>
              <span>
                {m.logbook_status_change({
                  from: statusLabelSafe(entry.from),
                  to: statusLabelSafe(entry.to),
                })}
              </span>
            </div>
          );
        })()}
      </Match>
    </Switch>
  );
}

function statusLabelSafe(status: string | null): string {
  return status ? statusLabel(status as LocationStatus) : "–";
}
