// Every job handler of the app, registered with the process-wide registry.
// Imported by the standalone worker (`scripts/worker.ts`) before it starts.
// A feature adds its handlers here (relative imports only: Nitro/standalone
// bundling may happen outside Vite's `~` alias).
import { handleReverseGeocode } from "../geocode/handler";
import { addPhotoJobs } from "../photos/jobs";
import { getPhotoStore } from "../photos/storage";
import { addTileJobs } from "../tiles/jobs";
import { pruneJobs } from "./queue";
import { nextDailyInBerlin } from "./schedule";
import { addJobHandler, jobRegistry } from "./worker";

let done = false;

export function registerAllJobHandlers() {
  if (done) return;
  done = true;
  const registry = jobRegistry();
  // Generic maintenance: drop successfully finished jobs older than seven days.
  // Handlers must be idempotent, so a crash re-runs this safely.
  addJobHandler(
    registry,
    "jobs.prune",
    (_payload, { db }) => pruneJobs(db, new Date(Date.now() - 7 * 86_400_000)),
    { recurring: { next: (now) => nextDailyInBerlin(now, 3) } },
  );
  // Reverse geocoding is best-effort and polite (1 req/s inside the handler).
  addJobHandler(registry, "geocode.reverse", handleReverseGeocode, {
    maxAttempts: 3,
    backoffBaseMs: 10_000,
  });
  // Photo processing runs in the standalone worker; e2e starts one too.
  addPhotoJobs(registry, getPhotoStore);
  // Tile regions are extracted by the worker only; TILES=off disables all of
  // them (e2e and tests). Nothing is downloaded by the web process.
  addTileJobs(registry);
}
