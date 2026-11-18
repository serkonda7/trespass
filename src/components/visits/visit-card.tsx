// One visit in the location timeline and the journal feed. `journalHtml` is
// sanitized on the server (src/server/markdown.ts) before it reaches innerHTML.

import { useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { createMemo, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { browserTimeZone, formatIsoDay } from "~/lib/format";
import { runAction } from "~/lib/run-action";
import { conditionBadges } from "~/lib/visits/labels";
import type { SerializedVisit } from "~/lib/visits/types";
import { m } from "~/paraglide/messages";
import { deleteVisitFn } from "~/server/visits/functions";

export function VisitCard(props: {
  visit: SerializedVisit;
  /** The location's IANA zone, when known to the caller. */
  tz?: string;
  showLocation?: boolean;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const badges = createMemo(() => conditionBadges(props.visit.conditions));
  const differentZone = createMemo(() => {
    const zone = props.tz;
    const browser = browserTimeZone();
    return Boolean(zone && browser && zone !== browser);
  });

  const onDelete = async () => {
    const r = await runAction(() => deleteVisitFn({ data: { id: props.visit.id } }), {
      success: m.visits_deleted(),
    });
    if (!r) return;
    await qc.invalidateQueries({ queryKey: ["visits"] });
    await qc.invalidateQueries({ queryKey: ["locations"] });
    props.onChanged?.();
  };

  return (
    <Card data-testid="visit-card">
      <CardContent class="grid gap-2 pt-4">
        <div class="flex flex-wrap items-center gap-2">
          <strong>{formatIsoDay(props.visit.visitedOn)}</strong>
          <Show when={differentZone()}>
            <Badge variant="secondary">{m.visits_local_time()}</Badge>
          </Show>
          <Show when={props.showLocation && props.visit.location}>
            {(loc) => (
              <Link
                to="/locations/$locationId"
                params={{ locationId: loc().id }}
                class="text-primary underline underline-offset-4"
              >
                {loc().name}
              </Link>
            )}
          </Show>
          <span class="text-sm text-muted-foreground">
            {m.logbook_by({ name: props.visit.authorName || m.visit_location_unknown() })}
          </span>
        </div>

        <Show when={props.visit.people.length > 0}>
          <p class="text-sm">
            {m.visits_with_people({
              names: props.visit.people.map((p) => p.displayName).join(", "),
            })}
          </p>
        </Show>

        <Show when={badges().length > 0}>
          <ul class="flex flex-wrap gap-1" aria-label={m.visits_condition()}>
            <For each={badges()}>
              {(badge) => (
                <li>
                  <Badge variant="outline">{badge}</Badge>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={props.visit.journalHtml}>
          <div
            class="prose prose-sm max-w-none break-words"
            data-testid="visit-journal"
            innerHTML={props.visit.journalHtml}
          />
        </Show>

        <Show when={props.visit.permissions.canEdit || props.visit.permissions.canDelete}>
          <div class="flex flex-wrap gap-2">
            <Show when={props.visit.permissions.canEdit}>
              <Link
                to="/visits/$visitId/edit"
                params={{ visitId: props.visit.id }}
                class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
              >
                {m.visits_edit()}
              </Link>
            </Show>
            <Show when={props.visit.permissions.canDelete}>
              <ConfirmButton
                label={m.visits_delete()}
                question={m.visits_delete_confirm()}
                confirmLabel={m.visits_delete()}
                destructive
                variant="destructive"
                onConfirm={onDelete}
              />
            </Show>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}
