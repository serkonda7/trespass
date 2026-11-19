import { createFileRoute } from "@tanstack/solid-router";
import { withAuth } from "@trespass/server/auth/context";
import { getDb } from "@trespass/server/db/client";
import { getPhotoStore } from "@trespass/server/photos/storage";
import { handleUploadRequest } from "@trespass/server/photos/upload";

// POST /api/v1/photos — multipart `file` (+ optional locationId, visitId,
// caption), one file per request. 201 { id } or { error: "PHOTO_…" }.
export const Route = createFileRoute("/api/v1/photos")({
  server: {
    handlers: {
      POST: withAuth<{ request: Request }>(({ request }, ctx) =>
        handleUploadRequest(getDb(), ctx, getPhotoStore(), request),
      ),
    },
  },
});
