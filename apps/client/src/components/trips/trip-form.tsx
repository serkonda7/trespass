// Create/edit form for trips (DESIGN §5.5): title, dates, people, emergency
// contact, notes and — when editing — status and the trip report (Markdown).
import { hasCoordinateLikeText } from "@trespass/shared/geo/coord-leak";
import type { PrincipalOption } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { TRIP_STATUSES, type TripStatus } from "@trespass/shared/trips/inputs";
import type { SerializedTrip } from "@trespass/shared/trips/types";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useHydrated } from "~/lib/hydrated";
import { tripStatusLabel } from "~/lib/labels";

type PersonRow = { userId: string; name: string };
type ContactKind = "none" | "user" | "external";
export type TripFormValues = {
  title: string;
  startsOn: string;
  endsOn: string;
  status: TripStatus;
  notes: string;
  reportMd: string;
  people: PersonRow[];
  contactKind: ContactKind;
  contactUserId: string;
  contactName: string;
  contactEmail: string;
  contactNtfy: string;
};

export const emptyTripValues = (): TripFormValues => ({
  title: "",
  startsOn: "",
  endsOn: "",
  status: "planned",
  notes: "",
  reportMd: "",
  people: [],
  contactKind: "none",
  contactUserId: "",
  contactName: "",
  contactEmail: "",
  contactNtfy: "",
});

export function valuesFromTrip(t: SerializedTrip): TripFormValues {
  const c = t.emergencyContact;
  return {
    title: t.title,
    startsOn: t.startsOn ?? "",
    endsOn: t.endsOn ?? "",
    status: t.status,
    notes: t.notes,
    reportMd: t.reportMd ?? "",
    people: t.people.map((p) => ({ userId: p.userId ?? "", name: p.name ?? "" })),
    contactKind: c ? (c.kind === "user" ? "user" : "external") : "none",
    contactUserId: c?.kind === "user" ? c.userId : "",
    contactName: c?.kind === "external" ? c.name : "",
    contactEmail: c?.kind === "external" ? (c.email ?? "") : "",
    contactNtfy: c?.kind === "external" ? (c.ntfyTopic ?? "") : "",
  };
}

export function tripPayload(v: TripFormValues) {
  const emergencyContact =
    v.contactKind === "user" && v.contactUserId
      ? { userId: v.contactUserId }
      : v.contactKind === "external" && v.contactName.trim()
        ? {
            name: v.contactName.trim(),
            email: v.contactEmail.trim() || null,
            ntfyTopic: v.contactNtfy.trim() || null,
          }
        : null;
  return {
    title: v.title.trim(),
    startsOn: v.startsOn || null,
    endsOn: v.endsOn || null,
    notes: v.notes,
    people: v.people.flatMap<{ userId: string } | { name: string }>((p) => {
      if (p.userId) return [{ userId: p.userId }];
      const name = p.name.trim();
      return name ? [{ name }] : [];
    }),
    emergencyContact,
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

export function TripForm(props: {
  initial: TripFormValues;
  principals: readonly PrincipalOption[];
  submitLabel: string;
  /** Editing an existing trip: status and report are shown. */
  editing?: boolean;
  conflict?: boolean;
  onReload?: () => void;
  onSubmit: (values: TripFormValues) => Promise<boolean>;
}) {
  const hydrated = useHydrated();
  const [v, setV] = createSignal<TripFormValues>(props.initial);
  const [busy, setBusy] = createSignal(false);
  const users = createMemo(() => props.principals.filter((p) => p.kind === "user"));
  const set = <K extends keyof TripFormValues>(k: K, value: TripFormValues[K]) =>
    setV((x) => ({ ...x, [k]: value }));
  const setPerson = (i: number, patch: Partial<PersonRow>) =>
    set(
      "people",
      v().people.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );
  const leak = createMemo(() => hasCoordinateLikeText(`${v().notes}\n${v().reportMd}`));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!hydrated() || busy()) return;
    setBusy(true);
    try {
      await props.onSubmit(v());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="grid gap-4" onSubmit={submit}>
      <fieldset class="grid gap-4" disabled={!hydrated() || busy()} aria-busy={!hydrated()}>
        <Show when={props.conflict}>
          <div class="rounded-md border border-destructive p-3" role="alert">
            <p class="font-semibold">{m.trips_conflict()}</p>
            <button
              type="button"
              class="mt-2 text-primary underline underline-offset-4"
              onClick={() => props.onReload?.()}
            >
              {m.visit_conflict_reload()}
            </button>
          </div>
        </Show>
        <Field id="trip-title" label={m.trips_field_title()}>
          <Input
            id="trip-title"
            required
            maxLength={160}
            value={v().title}
            onInput={(e) => set("title", e.currentTarget.value)}
          />
        </Field>
        <div class="grid gap-4 sm:grid-cols-2">
          <Field id="trip-start" label={m.trips_field_starts()}>
            <Input
              id="trip-start"
              type="date"
              value={v().startsOn}
              onInput={(e) => set("startsOn", e.currentTarget.value)}
            />
          </Field>
          <Field id="trip-end" label={m.trips_field_ends()}>
            <Input
              id="trip-end"
              type="date"
              value={v().endsOn}
              onInput={(e) => set("endsOn", e.currentTarget.value)}
            />
          </Field>
        </div>
        <Show when={props.editing}>
          <Field id="trip-status" label={m.trips_field_status()}>
            <select
              id="trip-status"
              class={inputClass}
              value={v().status}
              onChange={(e) => set("status", e.currentTarget.value as TripStatus)}
            >
              <For each={TRIP_STATUSES}>
                {(s) => <option value={s}>{tripStatusLabel(s)}</option>}
              </For>
            </select>
          </Field>
        </Show>

        <div class="grid gap-2">
          <Label>{m.trips_people()}</Label>
          <For each={v().people}>
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
                      v().people.filter((_, j) => j !== i()),
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
            class="justify-self-start"
            onClick={() => set("people", [...v().people, { userId: "", name: "" }])}
          >
            {m.visit_add_person()}
          </Button>
          <p class="text-xs text-muted-foreground">{m.trips_people_hint()}</p>
        </div>

        <fieldset class="grid gap-2 rounded-md border p-3">
          <legend class="px-1 text-sm font-medium">{m.trips_emergency_contact()}</legend>
          <select
            class={inputClass}
            aria-label={m.trips_emergency_contact()}
            value={v().contactKind}
            onChange={(e) => set("contactKind", e.currentTarget.value as ContactKind)}
          >
            <option value="none">{m.trips_contact_none()}</option>
            <option value="user">{m.trips_contact_user()}</option>
            <option value="external">{m.trips_contact_external()}</option>
          </select>
          <Show when={v().contactKind === "user"}>
            <select
              class={inputClass}
              aria-label={m.trips_contact_user()}
              value={v().contactUserId}
              onChange={(e) => set("contactUserId", e.currentTarget.value)}
            >
              <option value="">{m.visit_select_person()}</option>
              <For each={users()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </Show>
          <Show when={v().contactKind === "external"}>
            <Input
              placeholder={m.trips_contact_name()}
              aria-label={m.trips_contact_name()}
              value={v().contactName}
              onInput={(e) => set("contactName", e.currentTarget.value)}
            />
            <Input
              type="email"
              placeholder={m.trips_contact_email()}
              aria-label={m.trips_contact_email()}
              value={v().contactEmail}
              onInput={(e) => set("contactEmail", e.currentTarget.value)}
            />
            <Input
              placeholder={m.trips_contact_ntfy()}
              aria-label={m.trips_contact_ntfy()}
              value={v().contactNtfy}
              onInput={(e) => set("contactNtfy", e.currentTarget.value)}
            />
          </Show>
          <p class="text-xs text-muted-foreground">{m.trips_contact_hint()}</p>
        </fieldset>

        <Field id="trip-notes" label={m.trips_field_notes()}>
          <Textarea
            id="trip-notes"
            rows={4}
            value={v().notes}
            onInput={(e) => set("notes", e.currentTarget.value)}
          />
        </Field>
        <Show when={props.editing}>
          <Field id="trip-report" label={m.trips_field_report()}>
            <Textarea
              id="trip-report"
              rows={8}
              value={v().reportMd}
              onInput={(e) => set("reportMd", e.currentTarget.value)}
            />
          </Field>
        </Show>
        <Show when={leak()}>
          <p class="rounded-md border border-destructive p-3 text-sm text-destructive" role="alert">
            {m.location_coord_warning()}
          </p>
        </Show>
      </fieldset>
      <Button type="submit" disabled={!hydrated() || busy()} aria-busy={!hydrated()}>
        {hydrated() ? props.submitLabel : m.common_loading()}
      </Button>
    </form>
  );
}
