// /fotos/unsortiert: the uploader's unsorted photos, GPS-based suggestions and
// manual assignment to a location/visit. Suggestions never auto-attach.
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { inputClass } from "~/components/ui/input";
import { formatIsoDay } from "~/lib/format";
import { locationListQuery } from "~/lib/locations/queries";
import { unsortedPhotosQuery } from "~/lib/photos/queries";
import { photoUrl } from "~/lib/photos/rules";
import type { SerializedPhoto } from "~/lib/photos/types";
import { locationVisitsQuery } from "~/lib/visits/queries";
import { m } from "~/paraglide/messages";
import { assignPhotoFn, deletePhotoFn } from "~/server/photos/functions";
import { runPhotoAction } from "./action";
import { PhotoUploader } from "./uploader";

function UnsortedCard(props: { photo: SerializedPhoto; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  const locations = useQuery(() => locationListQuery({ limit: 2000 }));
  const [locationId, setLocationId] = createSignal(props.photo.suggestion?.locationId ?? "");
  const [visitId, setVisitId] = createSignal(props.photo.suggestion?.visitId ?? "");
  const visits = useQuery(() => locationVisitsQuery(locationId() || "__none__"));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["photos"] });
    await props.onChanged();
  };

  const accept = async () => {
    const s = props.photo.suggestion;
    if (!s) return;
    const r = await runPhotoAction(
      () =>
        assignPhotoFn({
          data: { id: props.photo.id, locationId: s.locationId, visitId: s.visitId },
        }),
      m.photos_assigned(),
    );
    if (r) await refresh();
  };

  const assign = async () => {
    if (!locationId()) return;
    const r = await runPhotoAction(
      () =>
        assignPhotoFn({
          data: { id: props.photo.id, locationId: locationId(), visitId: visitId() || null },
        }),
      m.photos_assigned(),
    );
    if (r) await refresh();
  };

  const remove = async () => {
    const r = await runPhotoAction(
      () => deletePhotoFn({ data: { id: props.photo.id } }),
      m.photos_deleted(),
    );
    if (r) await refresh();
  };

  return (
    <Card data-testid="unsorted-photo">
      <CardContent class="grid gap-3 pt-4 sm:grid-cols-[120px_1fr]">
        <img
          src={photoUrl(props.photo.id, 400)}
          alt={props.photo.caption ?? m.photos_title()}
          class="aspect-square w-full rounded-md border object-cover"
        />
        <div class="grid gap-2">
          <Show when={props.photo.suggestion}>
            {(s) => (
              <p class="rounded-md border border-accent p-2 text-sm" data-testid="photo-suggestion">
                {m.photos_suggestion({ name: s().locationName })}
                <Show when={s().visitedOn}>
                  {" · "}
                  {m.photos_suggestion_visit({ date: formatIsoDay(s().visitedOn!) })}
                </Show>
                <Button size="sm" variant="outline" class="ml-2" onClick={() => void accept()}>
                  {m.photos_accept_suggestion()}
                </Button>
              </p>
            )}
          </Show>
          <select
            class={inputClass}
            aria-label={m.photos_assign_location()}
            value={locationId()}
            onChange={(e) => {
              setLocationId(e.currentTarget.value);
              setVisitId("");
            }}
          >
            <option value="">{m.photos_assign_location()}</option>
            <For each={locations.data?.rows ?? []}>
              {(loc) => <option value={loc.id}>{loc.name}</option>}
            </For>
          </select>
          <Show when={locationId()}>
            <select
              class={inputClass}
              aria-label={m.photos_assign_visit()}
              value={visitId()}
              onChange={(e) => setVisitId(e.currentTarget.value)}
            >
              <option value="">{m.photos_assign_none()}</option>
              <For each={visits.data ?? []}>
                {(v) => (
                  <option value={v.id}>
                    {v.visitedOn} — {v.authorName}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" disabled={!locationId()} onClick={() => void assign()}>
              {m.photos_assign()}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void remove()}>
              {m.photos_delete()}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function UnsortedPhotos() {
  const qc = useQueryClient();
  const q = useQuery(() => unsortedPhotosQuery());
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["photos"] });
    await q.refetch();
  };
  return (
    <div class="grid gap-4">
      <PhotoUploader onUploaded={() => void refresh()} />
      <Show
        when={(q.data?.photos.length ?? 0) > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.photos_unsorted_empty()}</p>}
      >
        <For each={q.data?.photos ?? []}>
          {(photo) => <UnsortedCard photo={photo} onChanged={refresh} />}
        </For>
      </Show>
    </div>
  );
}
