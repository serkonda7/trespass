// Photo uploader: phone camera + multi-file picker, one request per file with
// progress and retry. One request per file keeps each upload small and lets a
// failed file be retried without re-sending the others.
import { useQueryClient } from "@tanstack/solid-query";
import { heicSupportedFn } from "@trespass/server/photos/functions";
import { goToLogin } from "@trespass/shared/error-text";
import { m } from "@trespass/shared/paraglide/messages";
import { photoErrorText } from "@trespass/shared/photos/errors";
import {
  ACCEPT_ATTR_BASE,
  ACCEPT_ATTR_HEIC,
  MAX_FILE_BYTES,
  uploadPhotoUrl,
} from "@trespass/shared/photos/rules";
import { createSignal, For, type JSX, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

type Status = "waiting" | "preparing" | "uploading" | "processing" | "done" | "error";
type Entry = { id: number; file: File; status: Status; progress: number; error?: string };

const PARALLEL = 2;
let nextId = 1;

export function PhotoUploader(props: {
  locationId?: string;
  visitId?: string;
  onUploaded?: (id: string) => void;
  class?: string;
}) {
  const qc = useQueryClient();
  const [entries, setEntries] = createStore<Entry[]>([]);
  const [dragging, setDragging] = createSignal(false);
  const [heic, setHeic] = createSignal(false);
  const [caption, setCaption] = createSignal("");
  let active = 0;

  onMount(() => {
    void heicSupportedFn()
      .then((r) => setHeic(r.supported))
      .catch(() => setHeic(false));
  });

  const update = (id: number, patch: Partial<Entry>) => setEntries((e) => e.id === id, patch);

  function add(files: FileList | File[] | null) {
    if (!files) return;
    const list = [...files].map<Entry>((file) => ({
      id: nextId++,
      file,
      status: "waiting",
      progress: 0,
    }));
    setEntries(produce((e) => e.push(...list)));
    pump();
  }

  function pump() {
    while (active < PARALLEL) {
      const next = entries.find((e) => e.status === "waiting");
      if (!next) return;
      active++;
      update(next.id, { status: "preparing" });
      const id = next.id;
      void run(id)
        .catch(() => update(id, { status: "error", error: photoErrorText("SERVER") }))
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function upload(
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<{ ok: true; id: string } | { ok: false; code: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadPhotoUrl());
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.upload.onload = () => onProgress(1);
      xhr.onload = () => {
        const body = xhr.response as { id?: string; error?: string } | null;
        if (xhr.status === 201 && body?.id) {
          resolve({ ok: true, id: body.id });
          return;
        }
        const code =
          xhr.status === 401
            ? "NOT_AUTHENTICATED"
            : xhr.status === 404
              ? "PHOTO_NOT_FOUND"
              : xhr.status === 403
                ? "PHOTO_FORBIDDEN"
                : xhr.status === 413
                  ? "PHOTO_TOO_LARGE"
                  : (body?.error ?? "SERVER");
        resolve({ ok: false, code });
      };
      xhr.onerror = () => resolve({ ok: false, code: "NETWORK" });
      xhr.onabort = () => resolve({ ok: false, code: "NETWORK" });
      const form = new FormData();
      form.set("file", file, file.name);
      if (props.locationId) form.set("locationId", props.locationId);
      if (props.visitId) form.set("visitId", props.visitId);
      if (caption().trim()) form.set("caption", caption().trim());
      xhr.send(form);
    });
  }

  async function run(id: number) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.file.size > MAX_FILE_BYTES) {
      update(id, { status: "error", error: photoErrorText("PHOTO_TOO_LARGE") });
      return;
    }
    update(id, { status: "uploading", progress: 0 });
    const r = await upload(entry.file, (p) =>
      update(id, p >= 1 ? { status: "processing", progress: 1 } : { progress: p }),
    );
    if (r.ok) {
      update(id, { status: "done", progress: 1 });
      await qc.invalidateQueries({ queryKey: ["photos"] });
      props.onUploaded?.(r.id);
      setTimeout(() => setEntries((e) => e.filter((x) => x.id !== id)), 2500);
      return;
    }
    if (r.code === "NOT_AUTHENTICATED") {
      goToLogin();
      return;
    }
    update(id, { status: "error", error: photoErrorText(r.code) });
  }

  function retry(id: number) {
    update(id, { status: "waiting", progress: 0, error: undefined });
    pump();
  }

  const dismiss = (id: number) => setEntries((e) => e.filter((x) => x.id !== id));
  const accept = () => (heic() ? ACCEPT_ATTR_HEIC : ACCEPT_ATTR_BASE);

  const statusText = (e: Entry) => {
    switch (e.status) {
      case "waiting":
        return m.photos_status_waiting();
      case "preparing":
        return m.photos_status_preparing();
      case "uploading":
        return m.photos_status_uploading({ percent: Math.round(e.progress * 100) });
      case "processing":
        return m.photos_status_processing();
      case "done":
        return m.photos_status_done();
      default:
        return e.error ?? "";
    }
  };

  const onDrop: JSX.EventHandler<HTMLDivElement, DragEvent> = (e) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer?.files ?? null);
  };

  let cameraInput!: HTMLInputElement;
  let fileInput!: HTMLInputElement;

  return (
    <div class={cn("grid gap-3", props.class)} data-testid="photo-uploader">
      <label class="grid gap-1 text-sm font-medium">
        {m.photos_caption_label()}
        <input
          class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={caption()}
          onInput={(e) => setCaption(e.currentTarget.value)}
        />
      </label>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the buttons are the accessible way in */}
      <div
        class={cn(
          "grid gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors",
          dragging() ? "border-primary bg-accent" : "border-input",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div class="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => cameraInput.click()}>
            {m.photos_take_photo()}
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInput.click()}>
            {m.photos_pick_files()}
          </Button>
        </div>
        <p class="hidden text-sm text-muted-foreground sm:block">
          {dragging() ? m.photos_drop_now() : m.photos_drop_hint()}
        </p>
        <p class="text-xs text-muted-foreground">
          {heic() ? m.photos_limits_hint_heic() : m.photos_limits_hint()}
        </p>
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photo-camera-input"
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={accept()}
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photo-file-input"
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <Show when={entries.length > 0}>
        <ul class="grid gap-2" aria-label={m.photos_queue_label()} aria-live="polite">
          <For each={entries}>
            {(e) => (
              <li
                class={cn(
                  "grid gap-1 rounded-md border p-2 text-sm",
                  e.status === "error" && "border-destructive",
                )}
                data-status={e.status}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-medium">{e.file.name || m.photos_unnamed()}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">
                    {Math.round(e.file.size / 1000)} kB
                  </span>
                </div>
                <Show
                  when={e.status !== "error"}
                  fallback={
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="text-destructive" role="alert">
                        {e.error}
                      </span>
                      <span class="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => retry(e.id)}>
                          {m.photos_retry()}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={m.photos_dismiss()}
                          onClick={() => dismiss(e.id)}
                        >
                          ✕
                        </Button>
                      </span>
                    </div>
                  }
                >
                  <div
                    class="h-1.5 overflow-hidden rounded bg-secondary"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(e.progress * 100)}
                  >
                    <div
                      class={cn(
                        "h-full bg-primary transition-[width]",
                        e.status === "processing" && "animate-pulse",
                      )}
                      style={{ width: `${Math.round(e.progress * 100)}%` }}
                    />
                  </div>
                  <span class="text-xs text-muted-foreground">{statusText(e)}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
