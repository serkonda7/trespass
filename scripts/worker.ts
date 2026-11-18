// Standalone job worker (DESIGN §10): `bun run worker`.
// The web process only validates env, migrates and serves requests; jobs are
// claimed and run here, in a separate process against the same WAL database.
// Handlers must be idempotent: a crash re-runs the interrupted job.
import { closeDb, getDb } from "../src/server/db/client";
import { getEnv } from "../src/server/env";
import { registerAllJobHandlers } from "../src/server/jobs/handlers";
import { startJobWorker, stopJobWorker } from "../src/server/jobs/worker";

const env = getEnv();
registerAllJobHandlers();
startJobWorker(getDb());
console.log(`[worker] started (${env.NODE_ENV}, ${env.DATABASE_PATH})`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received`);
  const finished = await stopJobWorker({ timeoutMs: 10_000 });
  closeDb();
  console.log(`[worker] stopped${finished ? "" : " (a job was left for the next start)"}`);
  process.exit(finished ? 0 : 1);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
