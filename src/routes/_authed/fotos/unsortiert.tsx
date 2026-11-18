import { createFileRoute } from "@tanstack/solid-router";
import { UnsortedPhotos } from "~/components/photos/unsorted";
import { m } from "~/paraglide/messages";

export const Route = createFileRoute("/_authed/fotos/unsortiert")({
  head: () => ({ meta: [{ title: `${m.photos_unsorted()} · ${m.app_name()}` }] }),
  component: () => (
    <div class="mx-auto grid max-w-3xl gap-4">
      <h1 class="text-2xl font-semibold">{m.photos_unsorted()}</h1>
      <UnsortedPhotos />
    </div>
  ),
});
