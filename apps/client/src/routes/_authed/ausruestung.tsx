import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import {
  createDefaultTemplatesFn,
  createEquipmentFn,
  createTemplateFn,
  deleteEquipmentFn,
  deleteTemplateFn,
  updateEquipmentFn,
  updateTemplateFn,
} from "@trespass/server/equipment/functions";
import { can } from "@trespass/shared/app-actions";
import { EQUIPMENT_CATEGORIES, type EquipmentCategory } from "@trespass/shared/equipment/inputs";
import type { SerializedEquipment, SerializedTemplate } from "@trespass/shared/equipment/types";
import { formatNumber } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
import { equipmentQuery } from "~/lib/equipment/queries";
import { useHydrated } from "~/lib/hydrated";
import { equipmentCategoryLabel } from "~/lib/labels";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/ausruestung")({
  beforeLoad: ({ context }) => {
    if (!can(context.user, "ownEquipment")) throw notFound();
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(equipmentQuery()),
  head: () => ({ meta: [{ title: `${m.equipment_title()} · ${m.app_name()}` }] }),
  component: EquipmentPage,
});

const formatWeight = (g: number) =>
  g >= 1000 ? `${formatNumber(g / 1000, 1)} kg` : `${formatNumber(g, 0)} g`;

type Draft = {
  id?: string;
  name: string;
  category: EquipmentCategory;
  weight: string;
  needsCharging: boolean;
  notes: string;
};
const emptyDraft = (): Draft => ({
  name: "",
  category: "light",
  weight: "",
  needsCharging: false,
  notes: "",
});

function EquipmentPage() {
  const qc = useQueryClient();
  const data = useQuery(() => equipmentQuery());
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["equipment"] });
  const byCategory = createMemo(() =>
    EQUIPMENT_CATEGORIES.map((c) => ({
      category: c,
      items: (data.data?.equipment ?? []).filter((e) => e.category === c),
    })).filter((g) => g.items.length > 0),
  );

  const edit = (e: SerializedEquipment) =>
    setDraft({
      id: e.id,
      name: e.name,
      category: e.category,
      weight: e.weightG === null ? "" : String(e.weightG),
      needsCharging: e.needsCharging,
      notes: e.notes ?? "",
    });

  const remove = async (e: SerializedEquipment) => {
    const r = await runAction(() => deleteEquipmentFn({ data: { id: e.id } }), {
      success: m.equipment_deleted(),
    });
    if (r) await refresh();
  };

  return (
    <div class="mx-auto grid max-w-3xl grid-cols-1 gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-2xl font-semibold">{m.equipment_title()}</h1>
        <Button onClick={() => setDraft(emptyDraft())} data-testid="add-equipment">
          {m.equipment_add()}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 class="text-lg font-semibold">{m.equipment_inventory()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4">
          <Show
            when={byCategory().length > 0}
            fallback={<p class="text-sm text-muted-foreground">{m.equipment_empty()}</p>}
          >
            <For each={byCategory()}>
              {(group) => (
                <section class="grid gap-2">
                  <h3 class="font-semibold">{equipmentCategoryLabel(group.category)}</h3>
                  <ul class="grid gap-2">
                    <For each={group.items}>
                      {(e) => (
                        <li
                          class="flex flex-wrap items-center gap-2 rounded-md border p-2"
                          data-testid="equipment-item"
                        >
                          <span class="flex-1">
                            {e.name}
                            <Show when={e.notes}>
                              <span class="block text-xs text-muted-foreground">{e.notes}</span>
                            </Show>
                          </span>
                          <Show when={e.needsCharging}>
                            <Badge variant="outline">{m.equipment_needs_charging()}</Badge>
                          </Show>
                          <Show when={e.weightG !== null}>
                            <span class="text-sm tabular-nums text-muted-foreground">
                              {formatWeight(e.weightG ?? 0)}
                            </span>
                          </Show>
                          <Button size="sm" variant="ghost" onClick={() => edit(e)}>
                            {m.equipment_edit()}
                          </Button>
                          <ConfirmButton
                            label={m.equipment_delete()}
                            question={m.equipment_delete_confirm({ name: e.name })}
                            confirmLabel={m.equipment_delete()}
                            destructive
                            variant="ghost"
                            onConfirm={() => remove(e)}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </Show>
        </CardContent>
      </Card>

      <Templates
        templates={data.data?.templates ?? []}
        equipment={data.data?.equipment ?? []}
        onChanged={refresh}
      />

      <Show when={draft()} keyed>
        {(d) => (
          <EquipmentDialog
            initial={d}
            onClose={() => setDraft(null)}
            onSaved={async () => {
              await refresh();
              setDraft(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

function EquipmentDialog(props: {
  initial: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const hydrated = useHydrated();
  const [d, setD] = createSignal(props.initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const submit = async (e: Event) => {
    e.preventDefault();
    const v = d();
    const weight = v.weight.trim() ? Math.round(Number(v.weight.replace(",", "."))) : null;
    const fields = {
      name: v.name.trim(),
      category: v.category,
      weightG: weight !== null && Number.isFinite(weight) ? weight : null,
      needsCharging: v.needsCharging,
      notes: v.notes.trim() || null,
    };
    const id = v.id;
    const r = id
      ? await runAction(() => updateEquipmentFn({ data: { id, ...fields } }), {
          success: m.equipment_saved(),
        })
      : await runAction(() => createEquipmentFn({ data: fields }), {
          success: m.equipment_saved(),
        });
    if (r) await props.onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.initial.id ? m.equipment_edit() : m.equipment_add()}</DialogTitle>
        </DialogHeader>
        <form class="grid gap-3" onSubmit={submit}>
          <div class="grid gap-1">
            <Label for="equipment-name">{m.equipment_field_name()}</Label>
            <Input
              id="equipment-name"
              required
              maxLength={120}
              value={d().name}
              onInput={(e) => set("name", e.currentTarget.value)}
            />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-1">
              <Label for="equipment-category">{m.equipment_field_category()}</Label>
              <select
                id="equipment-category"
                class={inputClass}
                value={d().category}
                onChange={(e) => set("category", e.currentTarget.value as EquipmentCategory)}
              >
                <For each={EQUIPMENT_CATEGORIES}>
                  {(c) => <option value={c}>{equipmentCategoryLabel(c)}</option>}
                </For>
              </select>
            </div>
            <div class="grid gap-1">
              <Label for="equipment-weight">{m.equipment_field_weight()}</Label>
              <Input
                id="equipment-weight"
                inputMode="numeric"
                pattern="\d*"
                value={d().weight}
                onInput={(e) => set("weight", e.currentTarget.value)}
              />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d().needsCharging}
              onChange={(e) => set("needsCharging", e.currentTarget.checked)}
            />
            {m.equipment_needs_charging()}
          </label>
          <div class="grid gap-1">
            <Label for="equipment-notes">{m.equipment_field_notes()}</Label>
            <Textarea
              id="equipment-notes"
              rows={2}
              value={d().notes}
              onInput={(e) => set("notes", e.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={!hydrated() || !d().name.trim()}>
              {hydrated() ? m.common_save() : m.common_loading()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Templates(props: {
  templates: readonly SerializedTemplate[];
  equipment: readonly SerializedEquipment[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = createSignal("");
  const create = async (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    const r = await runAction(() => createTemplateFn({ data: { name: name().trim() } }), {
      success: m.equipment_template_saved(),
    });
    if (r) {
      setName("");
      await props.onChanged();
    }
  };
  const defaults = async () => {
    const r = await runAction(() => createDefaultTemplatesFn());
    if (r) await props.onChanged();
  };
  const toggle = async (t: SerializedTemplate, equipmentId: string, on: boolean) => {
    const ids = on
      ? [...new Set([...t.equipmentIds, equipmentId])]
      : t.equipmentIds.filter((id) => id !== equipmentId);
    const r = await runAction(() => updateTemplateFn({ data: { id: t.id, equipmentIds: ids } }));
    if (r) await props.onChanged();
  };
  const remove = async (t: SerializedTemplate) => {
    const r = await runAction(() => deleteTemplateFn({ data: { id: t.id } }), {
      success: m.equipment_template_deleted(),
    });
    if (r) await props.onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 class="text-lg font-semibold">{m.equipment_templates()}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent class="grid gap-4">
        <p class="text-sm text-muted-foreground">{m.equipment_templates_hint()}</p>
        <Show when={props.templates.length === 0}>
          <div class="grid gap-1">
            <Button variant="outline" class="justify-self-start" onClick={() => void defaults()}>
              {m.equipment_templates_defaults()}
            </Button>
            <p class="text-xs text-muted-foreground">{m.equipment_templates_defaults_hint()}</p>
          </div>
        </Show>
        <For each={props.templates}>
          {(t) => (
            <details class="rounded-md border p-2" data-testid="pack-template">
              <summary class="cursor-pointer font-medium">
                {t.name}{" "}
                <span class="text-sm font-normal text-muted-foreground">
                  · {m.equipment_template_items({ count: t.equipmentIds.length })}
                  <Show when={t.weightG > 0}> · {formatWeight(t.weightG)}</Show>
                </span>
              </summary>
              <div class="grid gap-2 pt-2">
                <Show
                  when={props.equipment.length > 0}
                  fallback={<p class="text-sm text-muted-foreground">{m.equipment_empty()}</p>}
                >
                  <ul class="grid gap-1 sm:grid-cols-2">
                    <For each={props.equipment}>
                      {(e) => (
                        <li>
                          <label class="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={t.equipmentIds.includes(e.id)}
                              onChange={(ev) => void toggle(t, e.id, ev.currentTarget.checked)}
                            />
                            {e.name}
                          </label>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <ConfirmButton
                  label={m.equipment_template_delete()}
                  question={m.equipment_template_delete_confirm({ name: t.name })}
                  confirmLabel={m.equipment_template_delete()}
                  destructive
                  variant="ghost"
                  onConfirm={() => remove(t)}
                />
              </div>
            </details>
          )}
        </For>
        <form class="flex gap-2" onSubmit={create}>
          <Input
            aria-label={m.equipment_template_name()}
            placeholder={m.equipment_template_name()}
            maxLength={120}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <Button type="submit" variant="outline" disabled={!name().trim()}>
            {m.equipment_template_create()}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
