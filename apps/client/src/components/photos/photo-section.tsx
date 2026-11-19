// Everything photo-related on a location page: gallery + uploader. The server
// has already filtered the list; the UI only reads `permissions`.
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, onCleanup, Show } from "solid-js";
import { Card, CardContent } from "~/components/ui/card";
import { photosQuery } from "~/lib/photos/queries";
import { PhotoGallery } from "./gallery";
import { PhotoUploader } from "./uploader";

export function PhotoSection(props: {
  locationId: string;
  canContribute: boolean;
  canSetCover: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery(() => photosQuery({ locationId: props.locationId, limit: 2000 }));
  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: ["photos", "list", { locationId: props.locationId, limit: 2000 }],
    });
  };

  // A freshly uploaded photo is `processing` until the worker is done; poll
  // gently so the thumbnail appears without a manual reload.
  createEffect(() => {
    if (q.data?.photos.some((p) => p.status === "processing")) {
      const timer = setTimeout(() => void q.refetch(), 1200);
      onCleanup(() => clearTimeout(timer));
    }
  });

  return (
    <Card>
      <CardContent class="grid gap-4 pt-4">
        <PhotoGallery
          photos={q.data?.photos ?? []}
          locationId={props.locationId}
          canSetCover={props.canSetCover}
          onChanged={refresh}
        />
        <Show when={props.canContribute}>
          <PhotoUploader locationId={props.locationId} />
        </Show>
      </CardContent>
    </Card>
  );
}
