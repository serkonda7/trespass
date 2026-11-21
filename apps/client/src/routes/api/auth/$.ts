import { createFileRoute } from "@tanstack/solid-router";
import { getAuthHandler } from "@trespass/server/auth/context";

// Better Auth API under /api/auth/*, behind the per-username lockout (server/auth/handler.ts).
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => getAuthHandler()(request),
      POST: ({ request }) => getAuthHandler()(request),
    },
  },
});
