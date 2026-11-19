import { createFileRoute } from "@tanstack/solid-router";
import { getDb } from "@trespass/server/db/index";
import { healthStatus } from "@trespass/server/db/stats";

// Public, unauthenticated: only `ok` and `boots` (see healthStatus). The
// Docker healthcheck reads the status code, deploy/restore-test.sh both fields.
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          return Response.json(healthStatus(getDb()));
        } catch (err) {
          console.error("health check failed", err);
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
