// Photo thumbnails on a visit card and the picker that inserts `photo:ID`
// embeds into the journal editor. Both read the server-filtered photo list.
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { photosQuery } from "~/lib/photos/queries";
import { photoUrl } from "~/lib/photos/rules";
import { m } from "~/paraglide/messages";
import { PhotoGallery } from "./gallery";

export function VisitPhotoThumbs(props: { visitId: string }) {
  const q = useQuery(() => photosQuery({ visitId: props.visitId }));
  return (
    <Show when={(q.data?.photos.length ?? 0) > 0}>
      <div data-testid="visit-photo-thumbs">
        <p class="text-xs text-muted-foreground">{m.photos_visit_thumbs()}</p>
        <PhotoGallery
          photos={q.data?.photos ?? []}
          onChanged={() => void q.refetch()}
          class="pt-1"
        />
      </div>
    </Show>
  );
}

/** Buttons for the journal editor: clicking one inserts `![](photo:ID)`. */
export function PhotoEmbedPicker(props: { visitId: string; onPick: (id: string) => void }) {
  const q = useQuery(() => photosQuery({ visitId: props.visitId }));
  return (
    <div class="grid gap-2" data-testid="photo-embed-picker">
      <Show
        when={(q.data?.photos.length ?? 0) > 0}
        fallback={<p class="text-xs text-muted-foreground">{m.photos_insert_embed_empty()}</p>}
      >
        <ul class="flex flex-wrap gap-2">
          <For each={q.data?.photos ?? []}>
            {(p) => (
              <li>
                <button
                  type="button"
                  class="h-16 w-16 overflow-hidden rounded border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={p.caption ?? m.photos_insert_embed()}
                  onClick={() => props.onPick(p.id)}
                  data-testid="photo-embed-button"
                >
                  <img
                    src={photoUrl(p.id, 400)}
                    alt=""
                    class="size-full object-cover"
                    loading="lazy"
                  />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
