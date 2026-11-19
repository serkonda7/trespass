// The "Geschichte" tab (DESIGN §5.4): dated facts with sources. Drafts and all
// permission flags come from the server; editors (`edit`) create, change,
// approve and delete entries. Sources link out with rel=noopener noreferrer.
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  approveHistoryFn,
  createHistoryFn,
  deleteHistoryFn,
  updateHistoryFn,
} from "@trespass/server/history/functions";
import { formatIsoDay } from "@trespass/shared/format";
import { hasCoordinateLikeText } from "@trespass/shared/geo/coord-leak";
import { formatHistoryDate } from "@trespass/shared/history/format";
import { HISTORY_PRECISIONS, type HistoryPrecision } from "@trespass/shared/history/inputs";
import type { SerializedHistory } from "@trespass/shared/history/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { historyQuery } from "~/lib/history/queries";
import { useHydrated } from "~/lib/hydrated";
import { precisionLabel } from "~/lib/labels";
import { runAction } from "~/lib/run-action";

type SourceRow = { id?: string; url: string; title: string; excerpt: string };
type FormValues = {
  datePrecision: HistoryPrecision;
  dateFrom: string;
  dateTo: string;
  text: string;
  draft: boolean;
  sources: SourceRow[];
};

const empty = (): FormValues => ({
  datePrecision: "year",
  dateFrom: "",
  dateTo: "",
  text: "",
  draft: false,
  sources: [],
});

const fromEntry = (h: SerializedHistory): FormValues => ({
  datePrecision: h.datePrecision,
  dateFrom: h.dateFrom,
  dateTo: h.dateTo ?? "",
  text: h.text,
  draft: h.status === "draft",
  sources: h.sources.map((s) => ({
    id: s.id,
    url: s.url,
    title: s.title ?? "",
    excerpt: s.excerpt ?? "",
  })),
});

const sourcesPayload = (rows: SourceRow[]) =>
  rows
    .filter((s) => s.url.trim())
    .map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      url: s.url.trim(),
      title: s.title.trim() || null,
      excerpt: s.excerpt.trim() || null,
    }));

/** Input type for one precision: date, month or a four-digit year. */
function DateInput(props: {
  id: string;
  precision: HistoryPrecision;
  value: string;
  required?: boolean;
  onInput: (v: string) => void;
}) {
  return (
    <Input
      id={props.id}
      type={props.precision === "day" ? "date" : props.precision === "month" ? "month" : "text"}
      inputMode={props.precision === "day" || props.precision === "month" ? undefined : "numeric"}
      pattern={props.precision === "day" || props.precision === "month" ? undefined : "\\d{4}"}
      placeholder={props.precision === "day" || props.precision === "month" ? undefined : "1923"}
      required={props.required}
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
  );
}

export function HistorySection(props: { locationId: string; canEdit: boolean; shared: boolean }) {
  const qc = useQueryClient();
  const list = useQuery(() => historyQuery(props.locationId));
  const [editing, setEditing] = createSignal<SerializedHistory | "new" | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["history", props.locationId] }),
      qc.invalidateQueries({ queryKey: ["visits", "timeline", props.locationId] }),
      qc.invalidateQueries({ queryKey: ["locations", "search"] }),
    ]);

  const approve = async (h: SerializedHistory) => {
    const r = await runAction(() => approveHistoryFn({ data: { id: h.id, version: h.version } }), {
      success: m.history_approved(),
    });
    if (r) await refresh();
  };

  const remove = async (h: SerializedHistory) => {
    const r = await runAction(() => deleteHistoryFn({ data: { id: h.id } }), {
      success: m.history_deleted(),
    });
    if (r) await refresh();
  };

  return (
    <div class="grid gap-3" data-testid="history-section">
      <Show when={props.canEdit}>
        <div>
          <Button onClick={() => setEditing("new")} data-testid="add-history">
            {m.history_add()}
          </Button>
        </div>
      </Show>
      <Show
        when={(list.data?.length ?? 0) > 0}
        fallback={
          <Card>
            <CardContent class="pt-4">{m.history_empty()}</CardContent>
          </Card>
        }
      >
        <ol class="grid gap-3">
          <For each={list.data ?? []}>
            {(h) => (
              <li>
                <HistoryCard
                  entry={h}
                  onEdit={() => setEditing(h)}
                  onApprove={() => approve(h)}
                  onDelete={() => remove(h)}
                />
              </li>
            )}
          </For>
        </ol>
      </Show>
      <Show when={editing()}>
        {(current) => (
          <HistoryDialog
            locationId={props.locationId}
            entry={current() === "new" ? null : (current() as SerializedHistory)}
            shared={props.shared}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await refresh();
              setEditing(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

export function HistoryCard(props: {
  entry: SerializedHistory;
  onEdit?: () => void;
  onApprove?: () => void;
  onDelete?: () => void;
}) {
  const h = () => props.entry;
  return (
    <Card data-testid="history-entry">
      <CardContent class="grid gap-2 pt-4">
        <div class="flex flex-wrap items-center gap-2">
          <strong>{formatHistoryDate(h().dateFrom, h().dateTo, h().datePrecision)}</strong>
          <Show when={h().status === "draft"}>
            <Badge variant="secondary">{m.history_draft()}</Badge>
          </Show>
        </div>
        <p class="whitespace-pre-wrap">{h().text}</p>
        <Show when={h().sources.length > 0}>
          <div>
            <h4 class="text-sm font-semibold">{m.history_sources()}</h4>
            <ul class="grid gap-1 text-sm">
              <For each={h().sources}>
                {(s) => (
                  <li>
                    <a
                      href={s.url}
                      class="text-primary underline underline-offset-4 break-all"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {s.title || s.url}
                    </a>
                    <span class="text-muted-foreground">
                      {" · "}
                      {m.history_retrieved({ date: formatIsoDay(s.retrievedOn) })}
                    </span>
                    <Show when={s.archivedUrl}>
                      {(href) => (
                        <>
                          {" · "}
                          <a
                            href={href()}
                            class="text-primary underline underline-offset-4"
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {m.history_archived()}
                          </a>
                        </>
                      )}
                    </Show>
                    <Show when={s.archiveStatus === "pending"}>
                      <span class="text-muted-foreground"> · {m.history_archive_pending()}</span>
                    </Show>
                    <Show when={s.archiveStatus === "failed"}>
                      <span class="text-muted-foreground"> · {m.history_archive_failed()}</span>
                    </Show>
                    <Show when={s.excerpt}>
                      <blockquote class="mt-1 border-l-2 pl-2 italic text-muted-foreground">
                        {s.excerpt}
                      </blockquote>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
        <Show when={h().permissions.canEdit && props.onEdit}>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => props.onEdit?.()}>
              {m.history_edit()}
            </Button>
            <Show when={h().permissions.canApprove}>
              <Button size="sm" variant="outline" onClick={() => props.onApprove?.()}>
                {m.history_approve()}
              </Button>
            </Show>
            <Show when={h().permissions.canDelete}>
              <ConfirmButton
                label={m.history_delete()}
                question={m.history_delete_confirm()}
                confirmLabel={m.history_delete()}
                destructive
                variant="destructive"
                onConfirm={() => props.onDelete?.()}
              />
            </Show>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}

function HistoryDialog(props: {
  locationId: string;
  entry: SerializedHistory | null;
  shared: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const hydrated = useHydrated();
  const [v, setV] = createSignal<FormValues>(props.entry ? fromEntry(props.entry) : empty());
  const [busy, setBusy] = createSignal(false);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) =>
    setV((x) => ({ ...x, [k]: value }));
  const setSource = (i: number, patch: Partial<SourceRow>) =>
    set(
      "sources",
      v().sources.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const leak = createMemo(
    () =>
      props.shared &&
      (hasCoordinateLikeText(v().text) ||
        v().sources.some((s) => hasCoordinateLikeText(s.excerpt))),
  );

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    const values = v();
    const common = {
      datePrecision: values.datePrecision,
      dateFrom: values.dateFrom.trim(),
      dateTo: values.dateTo.trim() || null,
      text: values.text,
      sources: sourcesPayload(values.sources),
    };
    try {
      const entry = props.entry;
      const r = entry
        ? await runAction(
            () => updateHistoryFn({ data: { id: entry.id, version: entry.version, ...common } }),
            { success: m.history_saved() },
          )
        : await runAction(
            () =>
              createHistoryFn({
                data: {
                  locationId: props.locationId,
                  status: values.draft ? "draft" : "approved",
                  ...common,
                },
              }),
            { success: m.history_saved() },
          );
      if (r) await props.onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.entry ? m.history_edit() : m.history_add()}</DialogTitle>
        </DialogHeader>
        <form class="grid max-h-[70dvh] gap-3 overflow-y-auto" onSubmit={submit}>
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="grid gap-1">
              <Label for="history-precision">{m.history_field_precision()}</Label>
              <select
                id="history-precision"
                class={inputClass}
                value={v().datePrecision}
                onChange={(e) => {
                  set("datePrecision", e.currentTarget.value as HistoryPrecision);
                  set("dateFrom", "");
                  set("dateTo", "");
                }}
              >
                <For each={HISTORY_PRECISIONS}>
                  {(p) => <option value={p}>{precisionLabel(p)}</option>}
                </For>
              </select>
            </div>
            <div class="grid gap-1">
              <Label for="history-from">{m.history_field_from()}</Label>
              <DateInput
                id="history-from"
                precision={v().datePrecision}
                value={v().dateFrom}
                required
                onInput={(x) => set("dateFrom", x)}
              />
            </div>
            <div class="grid gap-1">
              <Label for="history-to">{m.history_field_to()}</Label>
              <DateInput
                id="history-to"
                precision={v().datePrecision}
                value={v().dateTo}
                onInput={(x) => set("dateTo", x)}
              />
            </div>
          </div>
          <div class="grid gap-1">
            <Label for="history-text">{m.history_field_text()}</Label>
            <Textarea
              id="history-text"
              rows={4}
              required
              value={v().text}
              onInput={(e) => set("text", e.currentTarget.value)}
            />
          </div>
          <Show when={!props.entry}>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v().draft}
                onChange={(e) => set("draft", e.currentTarget.checked)}
              />
              {m.history_field_draft()}
            </label>
          </Show>
          <fieldset class="grid gap-2">
            <legend class="text-sm font-medium">{m.history_sources()}</legend>
            <p class="text-xs text-muted-foreground">{m.history_archive_notice()}</p>
            <For each={v().sources}>
              {(s, i) => (
                <div class="grid gap-2 rounded-md border p-2" data-testid="history-source">
                  <Input
                    type="url"
                    placeholder="https://…"
                    aria-label={m.history_source_url()}
                    value={s.url}
                    onInput={(e) => setSource(i(), { url: e.currentTarget.value })}
                  />
                  <Input
                    placeholder={m.history_source_title()}
                    aria-label={m.history_source_title()}
                    value={s.title}
                    onInput={(e) => setSource(i(), { title: e.currentTarget.value })}
                  />
                  <Textarea
                    rows={2}
                    placeholder={m.history_source_excerpt()}
                    aria-label={m.history_source_excerpt()}
                    value={s.excerpt}
                    onInput={(e) => setSource(i(), { excerpt: e.currentTarget.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="justify-self-start"
                    onClick={() =>
                      set(
                        "sources",
                        v().sources.filter((_, j) => j !== i()),
                      )
                    }
                  >
                    {m.history_source_remove()}
                  </Button>
                </div>
              )}
            </For>
            <Button
              type="button"
              size="sm"
              variant="outline"
              class="justify-self-start"
              onClick={() => set("sources", [...v().sources, { url: "", title: "", excerpt: "" }])}
            >
              {m.history_source_add()}
            </Button>
          </fieldset>
          <Show when={leak()}>
            <p
              class="rounded-md border border-destructive p-2 text-sm text-destructive"
              role="alert"
            >
              {m.location_coord_warning()}
            </p>
          </Show>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={!hydrated() || busy()}>
              {hydrated() ? m.common_save() : m.common_loading()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
