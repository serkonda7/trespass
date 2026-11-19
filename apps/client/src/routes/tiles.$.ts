import { createFileRoute } from "@tanstack/solid-router";
import { authCtxFromRequest } from "@trespass/server/auth/context";
import { createTileGetHandler } from "@trespass/server/tiles/handler";
import { getAppTileReader } from "@trespass/server/tiles/store";

// Authenticated tile endpoint (DESIGN §7.1/§7.2). A splat file route is used
// because a literal ".mvt" after a dynamic segment is not a valid param name
// in TanStack Router. It answers 401 JSON — not a redirect — without a session.
const GET = createTileGetHandler({
  resolve: authCtxFromRequest,
  reader: getAppTileReader,
});

export const Route = createFileRoute("/tiles/$")({
  server: {
    handlers: {
      GET: (args) => {
        const parts = (args.params as { _splat?: string })._splat?.split("/") ?? [];
        // The URL ends in ".mvt"; anything else is not a tile.
        if (!parts[2]?.endsWith(".mvt") || parts.length !== 3) {
          return new Response(null, { status: 400 });
        }
        return GET({
          ...args,
          params: { z: parts[0], x: parts[1], y: parts[2].slice(0, -4) },
        });
      },
    },
  },
});
