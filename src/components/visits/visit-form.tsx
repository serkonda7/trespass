// Shared create/edit form for visits (DESIGN §5.2). Conditions are structured,
// people are either app users or free names, and the journal is Markdown with a
// server-rendered preview. Coordinates in free text warn on friends' locations.
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { hasCoordinateLikeText } from "~/lib/geo/coord-leak";
import { adoptTypedValue, useHydrated } from "~/lib/hydrated";
import type { PrincipalOption } from "~/lib/locations/types";
import { runAction } from "~/lib/run-action";
import {
  ACCESS_OPTIONS,
  accessLabel,
  CONDITION_OPTIONS,
  conditionLabel,
} from "~/lib/visits/labels";
import type { SerializedVisit, VisitAccess, VisitCondition } from "~/lib/visits/types";
import { m } from "~/paraglide/messages";
import { previewMarkdownFn } from "~/server/visits/functions";

export type VisitPersonRow = { userId: string; name: string };
export type VisitFormValues = {
  visitedOn: string;
  access: "" | VisitAccess;
  condition: "" | VisitCondition;
  securitySeen: boolean;
  hazards: string;
  people: VisitPersonRow[];
  journalMd: string;
};

export const emptyVisitValues = (today: string): VisitFormValues => ({
  visitedOn: today,
  access: "",
  condition: "",
  securitySeen: false,
  hazards: "",
  people: [],
  journalMd: "",
});

export const valuesFromVisit = (visit: SerializedVisit): VisitFormValues => ({
  visitedOn: visit.visitedOn,
  access: visit.conditions.access ?? "",
  condition: visit.conditions.condition ?? "",
  securitySeen: visit.conditions.securitySeen ?? false,
  hazards: (visit.conditions.hazards ?? []).join(", "),
  people: visit.people.map((p) => ({ userId: p.userId ?? "", name: p.name ?? "" })),
  journalMd: visit.journalMd ?? "",
});

export function visitPayload(v: VisitFormValues) {
  return {
    visitedOn: v.visitedOn,
    conditions: {
      ...(v.access ? { access: v.access } : {}),
      ...(v.condition ? { condition: v.condition } : {}),
      securitySeen: v.securitySeen,
      hazards: v.hazards
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    },
    people: v.people.flatMap<{ userId: string } | { name: string }>((p) => {
      if (p.userId) return [{ userId: p.userId }];
      const name = p.name.trim();
      return name ? [{ name }] : [];
    }),
    journalMd: v.journalMd,
  };
}

function Field(props: { id: string; label: string; children: JSX.Element }) {
  return (
    <div class="grid gap-2">
      <Label for={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}

export function VisitForm(props: {
  initial: VisitFormValues;
  principals: readonly PrincipalOption[];
  submitLabel: string;
  /** Warn about coordinate-like text when the location is shared. */
  shared: boolean;
  onSubmit: (values: VisitFormValues) => Promise<boolean>;
  conflict?: boolean;
  onReload?: () => void;
}) {
  const hydrated = useHydrated();
  const [values, setValues] = createSignal<VisitFormValues>(props.initial);
  const [preview, setPreview] = createSignal<string | null>(null);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const users = createMemo(() => props.principals.filter((p) => p.kind === "user"));
  const leak = createMemo(() => props.shared && hasCoordinateLikeText(values().journalMd));

  const set = <K extends keyof VisitFormValues>(key: K, value: VisitFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const setPerson = (index: number, patch: Partial<VisitPersonRow>) =>
    set(
      "people",
      values().people.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );

  const showPreview = async () => {
    setPreviewOpen(true);
    const result = await runAction(() => previewMarkdownFn({ data: { md: values().journalMd } }));
    if (result) setPreview(result.html);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!hydrated() || submitting()) return;
    setSubmitting(true);
    try {
      await props.onSubmit(values());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="grid gap-4" onSubmit={submit}>
      <fieldset class="grid gap-4" disabled={!hydrated() || submitting()} aria-busy={!hydrated()}>
        <Show when={props.conflict}>
          <div
            class="rounded-md border border-destructive p-3"
            role="alert"
            data-testid="edit-conflict"
          >
            <p class="font-semibold">{m.visit_conflict()}</p>
            <button
              type="button"
              class="mt-2 text-primary underline underline-offset-4"
              onClick={() => props.onReload?.()}
            >
              {m.visit_conflict_reload()}
            </button>
          </div>
        </Show>

        <Field id="visit-date" label={m.visit_field_date()}>
          <Input
            id="visit-date"
            type="date"
            required
            value={values().visitedOn}
            ref={adoptTypedValue(
              () => values().visitedOn,
              (v) => set("visitedOn", v),
            )}
            onInput={(e) => set("visitedOn", e.currentTarget.value)}
          />
        </Field>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field id="visit-access" label={m.visit_field_access()}>
            <select
              id="visit-access"
              class={inputClass}
              value={values().access}
              onChange={(e) => set("access", e.currentTarget.value as VisitFormValues["access"])}
            >
              <option value="">–</option>
              <For each={ACCESS_OPTIONS}>{(a) => <option value={a}>{accessLabel(a)}</option>}</For>
            </select>
          </Field>
          <Field id="visit-condition" label={m.visit_field_condition()}>
            <select
              id="visit-condition"
              class={inputClass}
              value={values().condition}
              onChange={(e) =>
                set("condition", e.currentTarget.value as VisitFormValues["condition"])
              }
            >
              <option value="">–</option>
              <For each={CONDITION_OPTIONS}>
                {(c) => <option value={c}>{conditionLabel(c)}</option>}
              </For>
            </select>
          </Field>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values().securitySeen}
            onChange={(e) => set("securitySeen", e.currentTarget.checked)}
          />
          {m.visit_field_security()}
        </label>

        <Field id="visit-hazards" label={m.visit_field_hazards()}>
          <Input
            id="visit-hazards"
            value={values().hazards}
            onInput={(e) => set("hazards", e.currentTarget.value)}
          />
        </Field>

        <div class="grid gap-2">
          <Label>{m.visit_field_people()}</Label>
          <For each={values().people}>
            {(person, i) => (
              <div class="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
                <select
                  class={inputClass}
                  aria-label={m.visit_select_person()}
                  value={person.userId}
                  onChange={(e) => setPerson(i(), { userId: e.currentTarget.value, name: "" })}
                >
                  <option value="">{m.visit_select_person()}</option>
                  <For each={users()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
                </select>
                <Input
                  value={person.name}
                  placeholder={m.visit_field_person_name()}
                  aria-label={m.visit_field_person_name()}
                  onInput={(e) => setPerson(i(), { name: e.currentTarget.value, userId: "" })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set(
                      "people",
                      values().people.filter((_, index) => index !== i()),
                    )
                  }
                >
                  {m.visits_delete()}
                </Button>
              </div>
            )}
          </For>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set("people", [...values().people, { userId: "", name: "" }])}
          >
            {m.visit_add_person()}
          </Button>
        </div>

        <Field id="visit-journal" label={m.visit_field_journal()}>
          <Textarea
            id="visit-journal"
            rows={10}
            value={values().journalMd}
            ref={adoptTypedValue(
              () => values().journalMd,
              (v) => set("journalMd", v),
            )}
            onInput={(e) => set("journalMd", e.currentTarget.value)}
          />
        </Field>

        <Show when={leak()}>
          <p class="rounded-md border border-destructive p-3 text-sm text-destructive" role="alert">
            {m.location_coord_warning()}
          </p>
        </Show>

        <div class="grid gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void showPreview()}>
            {m.visit_preview()}
          </Button>
          <Show when={previewOpen()}>
            <div
              class="min-h-12 rounded-md border p-3 text-sm"
              data-testid="visit-preview"
              innerHTML={preview() ?? ""}
            />
          </Show>
        </div>
      </fieldset>
      <Button type="submit" disabled={!hydrated() || submitting()} aria-busy={!hydrated()}>
        {hydrated() ? props.submitLabel : m.common_loading()}
      </Button>
    </form>
  );
}
