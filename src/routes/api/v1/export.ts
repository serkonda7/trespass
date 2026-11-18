import { createFileRoute } from "@tanstack/solid-router";
import { withAuth } from "~/server/auth/context";
import { getDb } from "~/server/db/client";
import { handleExportRequest } from "~/server/export/handler";
import { getPhotoStore } from "~/server/photos/storage";

// GET /api/v1/export[?ticket=…]: the caller's export as a streamed ZIP
// (admin: everything, member: own and visible data; DESIGN §3.5, §5.10).
// Signed-out callers get 401 JSON; guests get 404 JSON from the handler.
export const Route = createFileRoute("/api/v1/export")({
  server: {
    handlers: {
      GET: withAuth<{ request: Request }>(({ request }, ctx) =>
        handleExportRequest(getDb(), ctx, getPhotoStore(), request),
      ),
    },
  },
});
