// Photo gallery: square 400 px thumbs, tap for a larger image with prev/next.
// Editors get cover, caption, reorder and delete in the viewer. Everything the
// viewer receives is already serialized and filtered by the server.
import { createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { photoUrl } from "~/lib/photos/rules";
import type { SerializedPhoto } from "~/lib/photos/types";
import { m } from "~/paraglide/messages";
import {
  deletePhotoFn,
  reorderPhotosFn,
  setCoverPhotoFn,
  updatePhotoFn,
} from "~/server/photos/functions";
import { runPhotoAction } from "./action";

export const GALLERY_PREVIEW = 6;

export function PhotoGallery(props: {
  photos: SerializedPhoto[];
  locationId?: string;
  canSetCover?: boolean;
  onChanged: () => void | Promise<void>;
  class?: string;
}) {
  const [open, setOpen] = createSignal<number | null>(null);
  const [all, setAll] = createSignal(false);
  const [large, setLarge] = createSignal(false);
  const [caption, setCaption] = createSignal("");
  const shown = createMemo(() =>
    all() || props.photos.length <= GALLERY_PREVIEW + 1
      ? props.photos
      : props.photos.slice(0, GALLERY_PREVIEW),
  );
  const current = createMemo(() => {
    const i = open();
    return i === null ? undefined : props.photos[i];
  });

  const show = (i: number) => {
    setOpen(i);
    setCaption(props.photos[i]?.caption ?? "");
    setLarge(false);
  };

  async function changed() {
    setOpen(null);
    await props.onChanged();
  }

  async function saveCaption() {
    const p = current();
    if (!p) return;
    const r = await runPhotoAction(
      () => updatePhotoFn({ data: { id: p.id, caption: caption().trim() || null } }),
      m.photos_saved(),
    );
    if (r) await props.onChanged();
  }

  async function cover() {
    const p = current();
    if (!p || !props.locationId) return;
    const r = await runPhotoAction(
      () => setCoverPhotoFn({ data: { locationId: props.locationId!, photoId: p.id } }),
      m.photos_cover_set(),
    );
    if (r) await props.onChanged();
  }

  async function remove() {
    const p = current();
    if (!p) return;
    const r = await runPhotoAction(() => deletePhotoFn({ data: { id: p.id } }), m.photos_deleted());
    if (r) await changed();
  }

  async function move(delta: -1 | 1) {
    const p = current();
    const i = open();
    if (!p || i === null) return;
    const j = i + delta;
    if (j < 0 || j >= props.photos.length) return;
    const ids = props.photos.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const r = await runPhotoAction(() =>
      props.locationId
        ? reorderPhotosFn({ data: { locationId: props.locationId!, order: ids } })
        : Promise.reject(new Error("PHOTO_BAD_REQUEST")),
    );
    if (r) {
      await props.onChanged();
      setOpen(j);
    }
  }

  const exifLine = (p: SerializedPhoto): string =>
    [p.exif.make, p.exif.model].filter(Boolean).join(" ") || "";

  return (
    <div class={cn("grid gap-2", props.class)} data-testid="photo-gallery">
      <Show
        when={props.photos.length > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.photos_empty()}</p>}
      >
        <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={m.photos_title()}>
          <For each={shown()}>
            {(p, i) => (
              <li class="relative">
                <button
                  type="button"
                  class="block aspect-square w-full overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => show(i())}
                >
                  <img
                    src={photoUrl(p.id, 400)}
                    alt={m.photos_photo_alt({ n: i() + 1, total: props.photos.length })}
                    loading="lazy"
                    decoding="async"
                    class="size-full object-cover"
                  />
                </button>
                <Show when={i() === 0 && props.photos.length > 1}>
                  <span class="pointer-events-none absolute left-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium">
                    {m.photos_cover()}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.photos.length > shown().length || all()}>
          <Show when={props.photos.length > GALLERY_PREVIEW + 1}>
            <Button
              variant="outline"
              size="sm"
              class="justify-self-start"
              aria-expanded={all()}
              onClick={() => setAll(!all())}
            >
              {all() ? m.photos_show_fewer() : m.photos_show_all({ total: props.photos.length })}
            </Button>
          </Show>
        </Show>
      </Show>

      <Dialog open={open() !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent class="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {m.photos_photo_title({ n: (open() ?? 0) + 1, total: props.photos.length })}
            </DialogTitle>
          </DialogHeader>
          <Show when={current()}>
            {(p) => (
              <div class="grid gap-3">
                <img
                  src={photoUrl(p().id, large() ? 2560 : 1600)}
                  alt={p().caption ?? m.photos_title()}
                  class="mx-auto max-h-[60dvh] w-auto max-w-full rounded object-contain"
                />
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLarge(!large())}>
                    {large() ? "1600 px" : "2560 px"}
                  </Button>
                  <span class="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={m.photos_previous()}
                      disabled={(open() ?? 0) === 0}
                      onClick={() => show((open() ?? 0) - 1)}
                    >
                      ‹
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={m.photos_next()}
                      disabled={(open() ?? 0) >= props.photos.length - 1}
                      onClick={() => show((open() ?? 0) + 1)}
                    >
                      ›
                    </Button>
                  </span>
                </div>
                <Show when={exifLine(p())}>
                  <p class="text-xs text-muted-foreground">
                    {m.photos_exif_camera()}: {exifLine(p())}
                    <Show when={p().gps}>
                      {" · "}
                      {m.photos_approximate()}
                    </Show>
                  </p>
                </Show>
                <Show when={p().permissions.canEdit}>
                  <div class="grid gap-2">
                    <label class="grid gap-1 text-sm font-medium" for="photo-caption">
                      {m.photos_caption_label()}
                      <input
                        id="photo-caption"
                        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={caption()}
                        onInput={(e) => setCaption(e.currentTarget.value)}
                      />
                    </label>
                    <div class="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void saveCaption()}>
                        {m.common_save()}
                      </Button>
                      <Show when={props.canSetCover && props.locationId}>
                        <Button size="sm" variant="outline" onClick={() => void cover()}>
                          {m.photos_set_cover()}
                        </Button>
                      </Show>
                      <Show when={(open() ?? 0) > 0 && props.locationId}>
                        <Button size="sm" variant="outline" onClick={() => void move(-1)}>
                          {m.photos_move_earlier()}
                        </Button>
                      </Show>
                      <Show when={(open() ?? 0) < props.photos.length - 1 && props.locationId}>
                        <Button size="sm" variant="outline" onClick={() => void move(1)}>
                          {m.photos_move_later()}
                        </Button>
                      </Show>
                      <Show when={p().permissions.canDelete}>
                        <ConfirmButton
                          label={m.photos_delete()}
                          question={m.photos_delete_question({ name: p().caption ?? p().id })}
                          confirmLabel={m.photos_delete()}
                          destructive
                          variant="destructive"
                          onConfirm={() => void remove()}
                        />
                      </Show>
                    </div>
                  </div>
                </Show>
                <Show when={p().originalUrl}>
                  <a
                    class="text-sm text-primary underline underline-offset-4"
                    href={p().originalUrl}
                    target="_blank"
                    rel="noopener"
                  >
                    {m.photos_open_original()}
                  </a>
                </Show>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  );
}
