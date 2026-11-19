// Generates src/routeTree.gen.ts without starting a server, so `typecheck`
// and `test` work on a fresh checkout. Resolving the Vite config runs the
// TanStack Router generator (configResolved hook). Paraglide messages are
// compiled by the shared workspace's `gen` script (turbo runs it first).
import { resolveConfig } from "vite";

await resolveConfig({ configFile: "vite.config.ts", logLevel: "warn" }, "serve", "development");
