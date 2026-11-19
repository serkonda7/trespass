import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createAreaFn, deleteAreaFn, startScanFn } from "@trespass/server/research/functions";
import { formatDateTime, formatNumber } from "@trespass/shared/format";
import { closeRing, ringBbox } from "@trespass/shared/geo/polygon";
import type { Point } from "@trespass/shared/geo/types";
import type { LocationListItem } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { AREA_MAX_RADIUS_KM } from "@trespass/shared/research/inputs";
import {
  langForCountry,
  RESEARCH_LANGS,
  type ResearchLang,
} from "@trespass/shared/research/languages";
import type { SearchAreaDto } from "@trespass/shared/research/types";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { MapView } from "~/components/map/map-view";
import { LocationPicker } from "~/components/research/location-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input, inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useHydrated } from "~/lib/hydrated";
import { langLabel, runKindLabel, runStatusLabel } from "~/lib/research/labels";
import { researchAreasQuery } from "~/lib/research/queries";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/recherche/gebiete")({
  loader: ({ context }) => context.queryClient.ensureQueryData(researchAreasQuery()),
  head: () => ({ meta: [{ title: `${m.research_tab_areas()} · ${m.app_name()}` }] }),
  component: AreasPage,
});

const ringOf = (a: SearchAreaDto) => a.geom.coordinates[0] as [number, number][];

function AreasPage() {
  const qc = useQueryClient();
  const areas = useQuery(() => researchAreasQuery());
  const refresh = () => qc.invalidateQueries({ queryKey: ["research"] });
  return (
    <div class="grid gap-4">
      <AreaForm existing={areas.data ?? []} onSaved={refresh} />
      <Show
        when={(areas.data?.length ?? 0) > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.research_areas_empty()}</p>}
      >
        <ul class="grid gap-3" aria-label={m.research_tab_areas()}>
          <For each={areas.data}>{(area) => <AreaCard area={area} refresh={refresh} />}</For>
        </ul>
      </Show>
    </div>
  );
}

function AreaForm(props: { existing: readonly SearchAreaDto[]; onSaved: () => Promise<unknown> }) {
  const hydrated = useHydrated();
  const [name, setName] = createSignal("");
  const [lang, setLang] = createSignal<ResearchLang>("de");
  const [mode, setMode] = createSignal<"polygon" | "around">("polygon");
  const [points, setPoints] = createSignal<[number, number][]>([]);
  const [center, setCenter] = createSignal<LocationListItem | null>(null);
  const [radius, setRadius] = createSignal("5");
  const [busy, setBusy] = createSignal(false);

  const draft = createMemo(() => {
    const p = points();
    return p.length >= 3 ? closeRing(p) : p;
  });
  const polygons = () => [
    ...props.existing.map(ringOf),
    ...(mode() === "polygon" && draft().length ? [draft()] : []),
  ];
  const radiusKm = () => Number(radius().replace(",", "."));
  const circle = () => {
    const c = center();
    return mode() === "around" && c && radiusKm() > 0
      ? { point: c.point, radiusM: radiusKm() * 1000 }
      : null;
  };
  const fit = createMemo(() => {
    const all = props.existing.flatMap(ringOf);
    return all.length ? ringBbox(all) : null;
  });
  const canSave = () =>
    hydrated() &&
    !busy() &&
    name().trim().length > 0 &&
    (mode() === "polygon" ? points().length >= 3 : Boolean(center()) && radiusKm() > 0);

  const pick = (p: Point) => {
    if (mode() !== "polygon") return;
    setPoints([...points(), [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6]]);
  };

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSave()) return;
    setBusy(true);
    try {
      const c = center();
      const shape =
        mode() === "polygon"
          ? { type: "polygon" as const, ring: points() }
          : { type: "around" as const, locationId: c!.id, radiusKm: radiusKm() };
      const r = await runAction(
        () => createAreaFn({ data: { name: name().trim(), lang: lang(), shape } }),
        {
          success: m.research_area_saved(),
        },
      );
      if (r) {
        setName("");
        setPoints([]);
        setCenter(null);
        await props.onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{m.research_area_new()}</h2>
        </CardTitle>
        <CardDescription>{m.research_area_privacy()}</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-3" onSubmit={submit}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-1">
              <Label for="area-name">{m.research_area_name()}</Label>
              <Input
                id="area-name"
                required
                maxLength={120}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </div>
            <div class="grid gap-1">
              <Label for="area-lang">{m.research_area_lang()}</Label>
              <select
                id="area-lang"
                class={inputClass}
                value={lang()}
                onChange={(e) => setLang(e.currentTarget.value as ResearchLang)}
              >
                <For each={RESEARCH_LANGS}>{(l) => <option value={l}>{langLabel(l)}</option>}</For>
              </select>
            </div>
          </div>
          <fieldset class="flex flex-wrap gap-4 text-sm">
            <legend class="mb-1 text-sm font-medium">{m.research_area_mode()}</legend>
            <label class="flex items-center gap-2">
              <input
                type="radio"
                name="area-mode"
                checked={mode() === "polygon"}
                onChange={() => setMode("polygon")}
              />
              {m.research_area_mode_draw()}
            </label>
            <label class="flex items-center gap-2">
              <input
                type="radio"
                name="area-mode"
                checked={mode() === "around"}
                onChange={() => setMode("around")}
              />
              {m.research_area_mode_around()}
            </label>
          </fieldset>
          <Show when={mode() === "polygon"}>
            <p class="text-sm text-muted-foreground">{m.research_area_draw_hint()}</p>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span data-testid="area-points">
                {m.research_area_points({ count: points().length })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={points().length === 0}
                onClick={() => setPoints(points().slice(0, -1))}
              >
                {m.research_area_undo()}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={points().length === 0}
                onClick={() => setPoints([])}
              >
                {m.research_area_clear()}
              </Button>
            </div>
          </Show>
          <Show when={mode() === "around"}>
            <div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div class="grid gap-1">
                <Label for="area-location">{m.research_area_location()}</Label>
                <Show when={center()}>
                  {(c) => (
                    <p class="text-sm font-medium" data-testid="area-center">
                      {c().name}
                    </p>
                  )}
                </Show>
                <LocationPicker
                  id="area-location"
                  label={m.research_area_location()}
                  onPick={(row) => {
                    setCenter(row);
                    const guess = langForCountry(row.country);
                    if (guess) setLang(guess);
                    if (!name().trim()) setName(row.name);
                  }}
                />
              </div>
              <div class="grid content-start gap-1">
                <Label for="area-radius">{m.research_area_radius()}</Label>
                <Input
                  id="area-radius"
                  inputMode="decimal"
                  value={radius()}
                  onInput={(e) => setRadius(e.currentTarget.value)}
                  max={AREA_MAX_RADIUS_KM}
                />
              </div>
            </div>
          </Show>
          <div class="h-80 overflow-hidden rounded-md border">
            <MapView
              label={m.research_area_map_label()}
              onPick={pick}
              polygons={polygons()}
              circle={circle()}
              marker={mode() === "around" ? (center()?.point ?? null) : null}
              fit={fit()}
            />
          </div>
          <Button type="submit" class="justify-self-start" disabled={!canSave()}>
            {hydrated() ? m.research_area_save() : m.common_loading()}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AreaCard(props: { area: SearchAreaDto; refresh: () => Promise<unknown> }) {
  const a = () => props.area;
  const scan = async (kind: "scan.overpass" | "scan.wikidata") => {
    const r = await runAction(() => startScanFn({ data: { areaId: a().id, kind } }), {
      success: m.research_queued(),
    });
    if (r) await props.refresh();
  };
  return (
    <li>
      <Card>
        <CardContent class="grid gap-2 pt-4 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{a().name}</span>
            <span class="text-muted-foreground">· {langLabel(a().lang)}</span>
            <span class="ml-auto text-muted-foreground">
              {m.research_area_size({ km2: formatNumber(a().areaKm2, 1) })}
            </span>
          </div>
          <p class="text-muted-foreground">
            <Show when={a().lastScan} fallback={m.research_area_never()}>
              {(last) =>
                m.research_area_last({
                  kind: runKindLabel(last().kind),
                  status: runStatusLabel(last().status),
                  date: formatDateTime(last().at),
                })
              }
            </Show>
          </p>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void scan("scan.overpass")}>
              {m.research_area_scan_overpass()}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void scan("scan.wikidata")}>
              {m.research_area_scan_wikidata()}
            </Button>
            <ConfirmButton
              label={m.research_area_delete()}
              question={m.research_area_delete_confirm({ name: a().name })}
              destructive
              size="sm"
              variant="ghost"
              onConfirm={async () => {
                const r = await runAction(() => deleteAreaFn({ data: { id: a().id } }), {
                  success: m.research_area_deleted(),
                });
                if (r) await props.refresh();
              }}
            />
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
