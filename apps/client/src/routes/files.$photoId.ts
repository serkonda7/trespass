import { createFileRoute } from "@tanstack/solid-router";
import { withAuth } from "@trespass/server/auth/context";
import { getDb } from "@trespass/server/db/client";
import { servePhoto } from "@trespass/server/photos/serve";
import { getPhotoStore } from "@trespass/server/photos/storage";

// GET /files/:photoId?size=400|1600|2560|original (default 1600). Authorized
// file access (DESIGN §5.3): 404 for invisible photos and for originals the
// caller may not see. No static file route may bypass this handler.
export const Route = createFileRoute("/files/$photoId")({
  server: {
    handlers: {
      GET: withAuth<{ request: Request; params: { photoId: string } }>(({ request, params }, ctx) =>
        servePhoto(getDb(), ctx, getPhotoStore(), request, params.photoId),
      ),
      HEAD: withAuth<{ request: Request; params: { photoId: string } }>(
        ({ request, params }, ctx) =>
          servePhoto(getDb(), ctx, getPhotoStore(), request, params.photoId),
      ),
    },
  },
});
