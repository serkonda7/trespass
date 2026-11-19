// One inbox card (DESIGN §6.4): source(s) with quotes and whether they were
// checked, a confidence score, a mini map on demand, and the decisions.
// Everything comes from the admin-only research DTO; links to sources open
// with rel=noopener noreferrer.
import { useQuery } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { decideCandidateFn } from "@trespass/server/research/functions";
import { formatDateTime } from "@trespass/shared/format";
import { formatHistoryDate } from "@trespass/shared/history/format";
import { HISTORY_PRECISIONS, type HistoryPrecision } from "@trespass/shared/history/inputs";
import { m } from "@trespass/shared/paraglide/messages";
import type { DecideCandidateInput } from "@trespass/shared/research/inputs";
import { candidateTitle, factText } from "@trespass/shared/research/text";
import type {
  CandidateDto,
  FactPayload,
  NewLocationPayload,
  StatusChangePayload,
} from "@trespass/shared/research/types";
import { createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { DateInput } from "~/components/history/history-section";
import { MapView } from "~/components/map/map-view";
import { LocationPicker } from "~/components/research/location-picker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useHydrated } from "~/lib/hydrated";
import { precisionLabel } from "~/lib/labels";
import { categoriesQuery } from "~/lib/locations/queries";
import { statusLabel } from "~/lib/locations/status";
import { candidateKindLabel, evidenceSourceLabel } from "~/lib/research/labels";
import { runAction } from "~/lib/run-action";

type Decide = (input: Omit<DecideCandidateInput, "id">, success: string) => Promise<boolean>;

export function CandidateCard(props: {
  candidate: CandidateDto;
  onDecided: () => Promise<unknown>;
}) {
  const c = () => props.candidate;
  const [showMap, setShowMap] = createSignal(false);
  const [dialog, setDialog] = createSignal<"accept" | "later" | "merge" | "fact" | null>(null);
  const categories = useQuery(() => categoriesQuery());
  const categoryName = (key: string) => categories.data?.find((x) => x.key === key)?.name ?? key;
  const point = () => c().point ?? c().location?.point ?? null;
  const title = () => candidateTitle(c());

  const decide: Decide = async (input, success) => {
    const r = await runAction(() => decideCandidateFn({ data: { id: c().id, ...input } }), {
      success,
    });
    if (!r) return false;
    setDialog(null);
    await props.onDecided();
    return true;
  };

  return (
    <li id={`candidate-${c().id}`}>
      <Card>
        <CardContent class="grid gap-3 pt-4 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{candidateKindLabel(c().kind)}</Badge>
            <span class="font-medium" data-testid="candidate-title">
              {title()}
            </span>
            <span class="ml-auto text-muted-foreground">
              {m.research_confidence({ value: Math.round(c().confidence * 100) })}
            </span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <Show when={c().location}>
              {(l) => (
                <span>
                  {m.research_about()}{" "}
                  <Link
                    to="/locations/$locationId"
                    params={{ locationId: l().id }}
                    class="text-primary underline underline-offset-4"
                  >
                    {l().name}
                  </Link>
                </span>
              )}
            </Show>
            <Show when={c().area}>
              {(a) => <span>{m.research_from_area({ name: a().name })}</span>}
            </Show>
            <span>{formatDateTime(c().createdAt)}</span>
            <Show when={c().resultLocation}>
              {(l) => (
                <Link
                  to="/locations/$locationId"
                  params={{ locationId: l().id }}
                  class="text-primary underline underline-offset-4"
                >
                  {m.research_open_location()}: {l().name}
                </Link>
              )}
            </Show>
          </div>

          <Payload candidate={c()} categoryName={categoryName} />

          <section class="grid gap-2" aria-label={m.research_evidence()}>
            <h3 class="font-medium">{m.research_evidence()}</h3>
            <ul class="grid gap-2">
              <For each={c().evidence}>
                {(e) => (
                  <li class="grid gap-1 rounded-md border p-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-xs text-muted-foreground">
                        {evidenceSourceLabel(e.source)}
                      </span>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="break-all text-primary underline underline-offset-4"
                      >
                        {e.title || e.url}
                      </a>
                      <Badge variant={e.verified ? "outline" : "destructive"} class="ml-auto">
                        {e.verified ? m.research_verified() : m.research_unverified()}
                      </Badge>
                    </div>
                    <Show when={e.quote}>
                      <blockquote class="border-l-2 pl-2 italic">{e.quote}</blockquote>
                    </Show>
                    <Show when={e.archivedUrl}>
                      {(a) => (
                        <a
                          href={a()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-xs text-primary underline underline-offset-4"
                        >
                          {m.research_archived()}
                        </a>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </section>

          <Show when={point()}>
            {(p) => (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="justify-self-start"
                  onClick={() => setShowMap(!showMap())}
                >
                  {showMap() ? m.research_hide_map() : m.research_show_map()}
                </Button>
                <Show when={showMap()}>
                  <div class="h-48 overflow-hidden rounded-md border">
                    <MapView
                      label={m.research_mini_map()}
                      marker={p()}
                      fit={{
                        minLat: p().lat - 0.01,
                        maxLat: p().lat + 0.01,
                        minLon: p().lon - 0.015,
                        maxLon: p().lon + 0.015,
                      }}
                    />
                  </div>
                </Show>
              </>
            )}
          </Show>

          <Show when={c().status === "inbox"}>
            <div class="flex flex-wrap gap-2">
              <Show when={c().kind === "new_location"}>
                <Button
                  size="sm"
                  onClick={() => setDialog("accept")}
                  data-testid="candidate-accept"
                >
                  {m.research_action_accept()}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("later")}>
                  {m.research_action_later()}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("merge")}>
                  {m.research_action_merge()}
                </Button>
              </Show>
              <Show when={c().kind === "fact"}>
                <Button size="sm" onClick={() => setDialog("fact")} data-testid="candidate-accept">
                  {m.research_action_accept()}
                </Button>
              </Show>
              <Show when={c().kind === "status_change"}>
                <ConfirmButton
                  label={m.research_action_accept()}
                  question={m.research_suggested_status({
                    status: statusLabel((c().payload as StatusChangePayload).status),
                  })}
                  size="sm"
                  onConfirm={() => decide({ decision: "accept" }, m.research_decided_accepted())}
                />
              </Show>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void decide({ decision: "reject" }, m.research_decided_rejected())}
                data-testid="candidate-reject"
              >
                {m.research_action_reject()}
              </Button>
            </div>
          </Show>
        </CardContent>
      </Card>

      <Show when={dialog() === "accept" || dialog() === "later"}>
        <AcceptDialog
          candidate={c()}
          later={dialog() === "later"}
          categories={categories.data ?? []}
          onClose={() => setDialog(null)}
          decide={decide}
        />
      </Show>
      <Show when={dialog() === "merge"}>
        <MergeDialog candidate={c()} onClose={() => setDialog(null)} decide={decide} />
      </Show>
      <Show when={dialog() === "fact"}>
        <FactDialog candidate={c()} onClose={() => setDialog(null)} decide={decide} />
      </Show>
    </li>
  );
}

function FactLine(props: { fact: FactPayload }) {
  return (
    <span>
      <span class="font-medium">
        {formatHistoryDate(props.fact.dateFrom, props.fact.dateTo, props.fact.datePrecision)}
      </span>
      {": "}
      {factText(props.fact)}
    </span>
  );
}

function Payload(props: { candidate: CandidateDto; categoryName: (key: string) => string }) {
  const c = () => props.candidate;
  return (
    <>
      <Show when={c().kind === "new_location"}>
        {(() => {
          const p = () => c().payload as NewLocationPayload;
          return (
            <div class="grid gap-1">
              <span>
                {m.research_field_category()}: {props.categoryName(p().categoryKey)}
              </span>
              <Show when={p().description}>{(d) => <p>{d()}</p>}</Show>
              <Show when={Object.keys(p().tags ?? {}).length > 0}>
                <ul class="flex flex-wrap gap-1" aria-label={m.research_tags()}>
                  <For each={Object.entries(p().tags ?? {})}>
                    {([k, v]) => (
                      <li>
                        <code class="rounded bg-muted px-1 text-xs">{`${k}=${v}`}</code>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={(p().facts ?? []).length > 0}>
                <ul class="list-disc pl-5" aria-label={m.research_facts()}>
                  <For each={p().facts}>
                    {(f) => (
                      <li>
                        <FactLine fact={f} />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          );
        })()}
      </Show>
      <Show when={c().kind === "fact"}>
        <p>
          <FactLine fact={c().payload as FactPayload} />
        </p>
      </Show>
      <Show when={c().kind === "status_change"}>
        <p>
          <span class="font-medium">
            {m.research_suggested_status({
              status: statusLabel((c().payload as StatusChangePayload).status),
            })}
          </span>
          {" — "}
          {(c().payload as StatusChangePayload).reason}
        </p>
      </Show>
    </>
  );
}

function AcceptDialog(props: {
  candidate: CandidateDto;
  later: boolean;
  categories: readonly { id: string; key: string; name: string }[];
  onClose: () => void;
  decide: Decide;
}) {
  const hydrated = useHydrated();
  const payload = props.candidate.payload as NewLocationPayload;
  const [name, setName] = createSignal(candidateTitle(props.candidate));
  const [categoryId, setCategoryId] = createSignal(
    props.categories.find((c) => c.key === payload.categoryKey)?.id ??
      props.categories[0]?.id ??
      "",
  );
  const [description, setDescription] = createSignal(payload.description ?? "");
  const [busy, setBusy] = createSignal(false);
  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await props.decide(
        {
          decision: props.later ? "later" : "accept",
          name: name().trim(),
          categoryId: categoryId() || undefined,
          description: description().trim() || null,
        },
        m.research_decided_accepted(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.later ? m.research_action_later() : m.research_accept_title()}
          </DialogTitle>
          <DialogDescription>{m.research_accept_hint()}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-3" onSubmit={submit}>
          <div class="grid gap-1">
            <Label for="accept-name">{m.research_field_name()}</Label>
            <Input
              id="accept-name"
              required
              maxLength={200}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div class="grid gap-1">
            <Label for="accept-category">{m.research_field_category()}</Label>
            <select
              id="accept-category"
              class={inputClass}
              value={categoryId()}
              onChange={(e) => setCategoryId(e.currentTarget.value)}
            >
              <For each={props.categories}>{(c) => <option value={c.id}>{c.name}</option>}</For>
            </select>
          </div>
          <div class="grid gap-1">
            <Label for="accept-description">{m.research_field_description()}</Label>
            <Textarea
              id="accept-description"
              rows={3}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              disabled={!hydrated() || busy() || !name().trim()}
              data-testid="candidate-accept-submit"
            >
              {hydrated()
                ? props.later
                  ? m.research_action_later()
                  : m.research_action_accept()
                : m.common_loading()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog(props: { candidate: CandidateDto; onClose: () => void; decide: Decide }) {
  const merge = (targetLocationId: string) =>
    void props.decide({ decision: "merge", targetLocationId }, m.research_decided_merged());
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.research_merge_title()}</DialogTitle>
          <DialogDescription>{m.research_merge_hint()}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-3 text-sm">
          <h3 class="font-medium">{m.research_merge_nearby()}</h3>
          <Show
            when={props.candidate.nearby.length > 0}
            fallback={<p class="text-muted-foreground">{m.research_merge_none()}</p>}
          >
            <ul class="grid gap-1">
              <For each={props.candidate.nearby}>
                {(n) => (
                  <li class="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span>
                      {n.name}
                      <Show when={n.distanceM !== null}>
                        <span class="text-muted-foreground">
                          {" "}
                          · {m.research_merge_distance({ distance: n.distanceM ?? 0 })}
                        </span>
                      </Show>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => merge(n.id)}>
                      {m.research_merge_pick()}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Label for="merge-search">{m.research_merge_search()}</Label>
          <LocationPicker
            id="merge-search"
            label={m.research_merge_search()}
            onPick={(row) => merge(row.id)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {m.common_cancel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FactDialog(props: { candidate: CandidateDto; onClose: () => void; decide: Decide }) {
  const hydrated = useHydrated();
  const p = props.candidate.payload as FactPayload;
  const [precision, setPrecision] = createSignal<HistoryPrecision>(p.datePrecision);
  const [dateFrom, setDateFrom] = createSignal(p.dateFrom);
  const [text, setText] = createSignal(factText(p));
  const [busy, setBusy] = createSignal(false);
  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await props.decide(
        {
          decision: "accept",
          fact: { datePrecision: precision(), dateFrom: dateFrom().trim(), text: text().trim() },
        },
        m.research_decided_accepted(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.research_fact_title()}</DialogTitle>
        </DialogHeader>
        <form class="grid gap-3" onSubmit={submit}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-1">
              <Label for="fact-precision">{m.history_field_precision()}</Label>
              <select
                id="fact-precision"
                class={inputClass}
                value={precision()}
                onChange={(e) => {
                  setPrecision(e.currentTarget.value as HistoryPrecision);
                  setDateFrom("");
                }}
              >
                <For each={HISTORY_PRECISIONS}>
                  {(x) => <option value={x}>{precisionLabel(x)}</option>}
                </For>
              </select>
            </div>
            <div class="grid gap-1">
              <Label for="fact-date">{m.history_field_from()}</Label>
              <DateInput
                id="fact-date"
                precision={precision()}
                value={dateFrom()}
                required
                onInput={setDateFrom}
              />
            </div>
          </div>
          <div class="grid gap-1">
            <Label for="fact-text">{m.history_field_text()}</Label>
            <Textarea
              id="fact-text"
              rows={3}
              required
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              disabled={!hydrated() || busy()}
              data-testid="candidate-accept-submit"
            >
              {hydrated() ? m.research_action_accept() : m.common_loading()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
