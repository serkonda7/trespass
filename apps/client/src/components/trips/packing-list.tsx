// The trip's packing list (DESIGN §5.5): tick items while packing, add free
// lines or merge one of your own packing templates.
import { useQuery } from "@tanstack/solid-query";
import {
  addChecklistItemFn,
  addTemplateToTripFn,
  removeChecklistItemFn,
  setChecklistPackedFn,
} from "@trespass/server/trips/functions";
import { m } from "@trespass/shared/paraglide/messages";
import type { SerializedTrip } from "@trespass/shared/trips/types";
import { createSignal, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, inputClass } from "~/components/ui/input";
import { equipmentQuery } from "~/lib/equipment/queries";
import { runAction } from "~/lib/run-action";

export function PackingList(props: {
  trip: SerializedTrip;
  /** The viewer may own equipment (templates come from their own list). */
  canUseTemplates: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [label, setLabel] = createSignal("");
  const [template, setTemplate] = createSignal("");
  const gear = useQuery(() => ({
    ...equipmentQuery(),
    enabled: props.trip.permissions.canEdit && props.canUseTemplates,
  }));
  const packed = () => props.trip.checklist.filter((i) => i.packed).length;

  const toggle = async (id: string, value: boolean) => {
    const r = await runAction(() => setChecklistPackedFn({ data: { id, packed: value } }));
    if (r) await props.onChanged();
  };
  const add = async (e: Event) => {
    e.preventDefault();
    if (!label().trim()) return;
    const r = await runAction(() =>
      addChecklistItemFn({ data: { tripId: props.trip.id, label: label().trim() } }),
    );
    if (r) {
      setLabel("");
      await props.onChanged();
    }
  };
  const merge = async () => {
    if (!template()) return;
    const r = await runAction(
      () => addTemplateToTripFn({ data: { tripId: props.trip.id, templateId: template() } }),
      { success: (x) => m.trips_template_added({ count: x.added }) },
    );
    if (r) await props.onChanged();
  };
  const remove = async (id: string) => {
    const r = await runAction(() => removeChecklistItemFn({ data: { id } }));
    if (r) await props.onChanged();
  };

  return (
    <div class="grid gap-3" data-testid="packing-list">
      <Show
        when={props.trip.checklist.length > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.trips_packing_empty()}</p>}
      >
        <p class="text-sm text-muted-foreground">
          {m.trips_packed_count({ packed: packed(), total: props.trip.checklist.length })}
        </p>
        <ul class="grid gap-1">
          <For each={props.trip.checklist}>
            {(item) => (
              <li class="flex items-center gap-2">
                <label class="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    class="size-5"
                    checked={item.packed}
                    disabled={!props.trip.permissions.canPack}
                    onChange={(e) => void toggle(item.id, e.currentTarget.checked)}
                  />
                  <span class={item.packed ? "text-muted-foreground line-through" : ""}>
                    {item.label}
                  </span>
                  <Show when={item.needsCharging}>
                    <Badge variant="outline">{m.equipment_needs_charging()}</Badge>
                  </Show>
                </label>
                <Show when={props.trip.permissions.canEdit}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={m.trips_packing_remove({ label: item.label })}
                    onClick={() => void remove(item.id)}
                  >
                    ✕
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.trip.permissions.canEdit}>
        <form class="flex gap-2" onSubmit={add}>
          <Input
            aria-label={m.trips_packing_add()}
            placeholder={m.trips_packing_add()}
            maxLength={120}
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
          />
          <Button type="submit" variant="outline" disabled={!label().trim()}>
            {m.trips_packing_add_button()}
          </Button>
        </form>
        <Show when={(gear.data?.templates.length ?? 0) > 0}>
          <div class="flex gap-2">
            <select
              class={inputClass}
              aria-label={m.trips_template()}
              value={template()}
              onChange={(e) => setTemplate(e.currentTarget.value)}
            >
              <option value="">{m.trips_template()}</option>
              <For each={gear.data?.templates ?? []}>
                {(t) => <option value={t.id}>{t.name}</option>}
              </For>
            </select>
            <Button variant="outline" disabled={!template()} onClick={() => void merge()}>
              {m.trips_template_add()}
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
