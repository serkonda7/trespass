// Shared create/edit form (DESIGN §4). Coordinates are parsed live with the
// same pure helper the server uses; nothing about visibility is decided here.
import { createForm } from "@tanstack/solid-form";
import { findCoordinateLikeText } from "@trespass/shared/geo/coord-leak";
import { formatCoordinates, parseCoordinates } from "@trespass/shared/geo/parse-coords";
import type {
  CategoryRow,
  FriendsLevel,
  SerializedLocation,
  StoredLocationStatus,
  Visibility,
} from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createEffect, createMemo, For, type JSX, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { InfoTip } from "~/components/ui/info-tip";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useHydrated } from "~/lib/hydrated";
import { EDITABLE_STATUSES, statusHint, statusLabel } from "~/lib/locations/status";
import { CategoryIcon } from "./category-icon";

export type LocationFormValues = {
  name: string;
  categoryId: string;
  status: StoredLocationStatus;
  coordText: string;
  visibility: Visibility;
  friendsLevel: FriendsLevel;
  description: string;
  accessNotes: string;
  dangerNotes: string;
  builtYear: string;
  abandonedYear: string;
  tags: string;
};

export const emptyLocationValues = (categories: readonly CategoryRow[]): LocationFormValues => ({
  name: "",
  categoryId: categories[0]?.id ?? "",
  status: "idea",
  coordText: "",
  visibility: "private",
  friendsLevel: "view",
  description: "",
  accessNotes: "",
  dangerNotes: "",
  builtYear: "",
  abandonedYear: "",
  tags: "",
});

export const valuesFromLocation = (loc: SerializedLocation): LocationFormValues => ({
  name: loc.name,
  categoryId: loc.categoryId,
  status: loc.storedStatus,
  coordText: formatCoordinates(loc.point),
  visibility: loc.visibility,
  friendsLevel: loc.friendsLevel,
  description: loc.description ?? "",
  accessNotes: loc.accessNotes ?? "",
  dangerNotes: loc.dangerNotes ?? "",
  builtYear: loc.builtYear ? String(loc.builtYear) : "",
  abandonedYear: loc.abandonedYear ? String(loc.abandonedYear) : "",
  tags: (loc.tags ?? []).join(", "),
});

function Field(props: {
  id: string;
  label: string;
  hint?: string;
  /** Shown behind an "i" next to the label (id: `${id}-info`). */
  info?: string;
  children: JSX.Element;
}) {
  return (
    <div class="grid content-start gap-2">
      <div class="relative flex min-h-5 items-center gap-1.5">
        <Label for={props.id}>{props.label}</Label>
        <Show when={props.info}>{(text) => <InfoTip id={`${props.id}-info`} text={text()} />}</Show>
      </div>
      {props.children}
      <Show when={props.hint}>
        <p class="text-sm text-muted-foreground">{props.hint}</p>
      </Show>
    </div>
  );
}

export function LocationForm(props: {
  mode: "create" | "edit";
  initial: LocationFormValues;
  categories: readonly CategoryRow[];
  onSubmit: (values: LocationFormValues) => Promise<boolean>;
  onValuesChange?: (values: LocationFormValues) => void;
  /** A map pick: the nonce makes two identical picks observable. */
  pick?: { point: { lat: number; lon: number }; nonce: number } | null;
  extra?: JSX.Element;
  submitLabel: string;
}) {
  const hydrated = useHydrated();
  const form = createForm(() => ({
    defaultValues: props.initial,
    onSubmit: async ({ value }) => {
      await props.onSubmit(value);
    },
  }));
  const values = form.useStore((s) => s.values);

  const set = <K extends keyof LocationFormValues>(key: K, v: LocationFormValues[K]) =>
    (form.setFieldValue as (k: string, value: unknown) => void)(key, v);

  const point = createMemo(() => parseCoordinates(values().coordText));
  const coordError = createMemo(() => values().coordText.trim() !== "" && point() === null);

  const leak = createMemo(() => {
    if (values().visibility !== "friends") return false;
    return (
      findCoordinateLikeText(
        [values().description, values().accessNotes, values().dangerNotes, values().tags].join(
          "\n",
        ),
      ).length > 0
    );
  });

  // Duplicate suggestion and map picking are wired by the create page, which
  // observes the current values and calls `set("coordText", ...)` on a pick.
  const notify = () => props.onValuesChange?.(values());

  createEffect(() => {
    const pick = props.pick;
    if (!pick) return;
    set("coordText", formatCoordinates(pick.point));
    notify();
  });

  return (
    <form
      class="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset
        class="grid gap-4"
        disabled={!hydrated() || form.state.isSubmitting}
        aria-busy={!hydrated()}
      >
        <Field id="location-name" label={m.location_field_name()}>
          <Input
            id="location-name"
            name="name"
            required
            maxLength={200}
            autocomplete="off"
            value={values().name}
            onInput={(e) => set("name", e.currentTarget.value)}
          />
        </Field>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid content-start gap-2">
            <Select<CategoryRow>
              class="grid content-start gap-2"
              options={[...props.categories]}
              optionValue="id"
              optionTextValue="name"
              value={props.categories.find((c) => c.id === values().categoryId) ?? null}
              onChange={(c) => c && set("categoryId", c.id)}
              disallowEmptySelection
              itemComponent={(p) => (
                <SelectItem item={p.item}>
                  <span class="flex items-center gap-2">
                    <CategoryIcon name={p.item.rawValue.icon} class="size-5 shrink-0" />
                    {p.item.rawValue.name}
                  </span>
                </SelectItem>
              )}
            >
              <div class="flex min-h-5 items-center">
                <SelectLabel>{m.location_field_category()}</SelectLabel>
              </div>
              <SelectTrigger>
                <SelectValue<CategoryRow>>
                  {(state) => (
                    <span class="flex items-center gap-2">
                      <CategoryIcon name={state.selectedOption().icon} class="size-5 shrink-0" />
                      {state.selectedOption().name}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <Field
            id="location-status"
            label={m.location_field_status()}
            hint={statusHint(values().status)}
          >
            <select
              id="location-status"
              class={inputClass}
              value={values().status}
              onChange={(e) => set("status", e.currentTarget.value as StoredLocationStatus)}
            >
              <For each={EDITABLE_STATUSES}>
                {(s) => <option value={s}>{statusLabel(s)}</option>}
              </For>
            </select>
          </Field>
        </div>

        <Show when={props.mode === "create"}>
          <Field
            id="location-coords"
            label={m.location_field_coordinates()}
            info={m.location_coordinates_hint()}
          >
            <Input
              id="location-coords"
              name="coordinates"
              required
              aria-describedby="location-coords-info"
              value={values().coordText}
              aria-invalid={coordError()}
              onInput={(e) => {
                set("coordText", e.currentTarget.value);
                notify();
              }}
            />
            <Show when={point()}>
              <p class="text-sm text-success" role="status">
                {m.location_coordinates_parsed({ coords: formatCoordinates(point()!) })}
              </p>
            </Show>
            <Show when={coordError()}>
              <p class="text-sm text-destructive" role="alert">
                {m.location_coordinates_error()}
              </p>
            </Show>
          </Field>
        </Show>

        <Field id="location-description" label={m.location_field_description()}>
          <Textarea
            id="location-description"
            maxLength={5000}
            value={values().description}
            onInput={(e) => set("description", e.currentTarget.value)}
          />
        </Field>

        <Show when={props.mode === "create"}>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field id="location-visibility" label={m.location_field_visibility()}>
              <select
                id="location-visibility"
                class={inputClass}
                value={values().visibility}
                onChange={(e) => set("visibility", e.currentTarget.value as Visibility)}
              >
                <option value="private">{m.location_visibility_private()}</option>
                <option value="friends">{m.location_visibility_friends()}</option>
              </select>
            </Field>
            <Show when={values().visibility === "friends"}>
              <Field id="location-friends-level" label={m.location_field_friends_level()}>
                <select
                  id="location-friends-level"
                  class={inputClass}
                  value={values().friendsLevel}
                  onChange={(e) => set("friendsLevel", e.currentTarget.value as FriendsLevel)}
                >
                  <option value="view">{m.location_friends_level_view()}</option>
                  <option value="contribute">{m.location_friends_level_contribute()}</option>
                </select>
              </Field>
            </Show>
          </div>
          <Show when={leak()}>
            <p
              class="rounded-md border border-destructive p-3 text-sm text-destructive"
              role="alert"
            >
              {m.location_coord_warning()}
            </p>
          </Show>
        </Show>

        <details class="rounded-md border p-3">
          <summary class="cursor-pointer font-medium">{m.location_details()}</summary>
          <div class="mt-3 grid gap-4">
            <Field id="location-access" label={m.location_field_access_notes()}>
              <Textarea
                id="location-access"
                maxLength={5000}
                value={values().accessNotes}
                onInput={(e) => set("accessNotes", e.currentTarget.value)}
              />
            </Field>
            <Field id="location-danger" label={m.location_field_danger_notes()}>
              <Textarea
                id="location-danger"
                maxLength={5000}
                value={values().dangerNotes}
                onInput={(e) => set("dangerNotes", e.currentTarget.value)}
              />
            </Field>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field id="location-built" label={m.location_field_built_year()}>
                <Input
                  id="location-built"
                  type="number"
                  min="1"
                  max="9999"
                  value={values().builtYear}
                  onInput={(e) => set("builtYear", e.currentTarget.value)}
                />
              </Field>
              <Field id="location-abandoned" label={m.location_field_abandoned_year()}>
                <Input
                  id="location-abandoned"
                  type="number"
                  min="1"
                  max="9999"
                  value={values().abandonedYear}
                  onInput={(e) => set("abandonedYear", e.currentTarget.value)}
                />
              </Field>
            </div>
            <Field id="location-tags" label={m.location_field_tags()}>
              <Input
                id="location-tags"
                value={values().tags}
                onInput={(e) => {
                  set("tags", e.currentTarget.value);
                  notify();
                }}
              />
            </Field>
          </div>
        </details>

        {props.extra}
      </fieldset>
      <div class="flex gap-2">
        <Button
          type="submit"
          disabled={!hydrated() || form.state.isSubmitting}
          aria-busy={!hydrated()}
        >
          {hydrated() ? props.submitLabel : m.common_loading()}
        </Button>
      </div>
    </form>
  );
}

/** Converts form strings into the server input shape. */
export const formPayload = (v: LocationFormValues) => ({
  name: v.name.trim(),
  categoryId: v.categoryId,
  status: v.status,
  point: parseCoordinates(v.coordText),
  description: v.description || null,
  accessNotes: v.accessNotes || null,
  dangerNotes: v.dangerNotes || null,
  builtYear: v.builtYear ? Number(v.builtYear) : null,
  abandonedYear: v.abandonedYear ? Number(v.abandonedYear) : null,
  tags: v.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
});
