// Started by Playwright's webServer (run with bun). Builds the app into its
// own output dir (never the shared .output), wipes the throwaway data dir,
// starts the production server against it and records the bootstrap invite
// link the app prints at startup. The production build avoids dev-server
// full reloads (e.g. Paraglide recompiling) that make dev-mode e2e flaky.
// E2E_SKIP_BUILD=1 reuses the previous e2e build for quick reruns.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOOTSTRAP_LINK_FILE, E2E_BUILD_DIR, E2E_DB, E2E_DIR, E2E_ORIGIN, E2E_PORT } from "./env";

const entry = `${E2E_BUILD_DIR}/server/index.mjs`;
if (process.env.E2E_SKIP_BUILD !== "1" || !existsSync(entry)) {
  const build = spawnSync("bunx", ["vite", "build"], {
    env: { ...process.env, NITRO_OUTPUT_DIR: E2E_BUILD_DIR },
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
  // The build leaves src/paraglide in Vite's virtual-module form; regenerate
  // the plain files so `bun test` keeps working afterwards.
  spawnSync("bun", ["run", "gen"], { stdio: "ignore" });
}

rmSync(E2E_DIR, { recursive: true, force: true });
mkdirSync(E2E_DIR, { recursive: true });

// The web process never runs jobs (DESIGN §10). E2E starts the standalone
// worker against the same throwaway DB so photos.process really runs. The
// worker runs from apps/server's TypeScript sources; only the web app is built.
const runtimeEnv = {
  ...process.env,
  NODE_ENV: "production",
  // Test-only secret; production requires a real one (deploy/.env BETTER_AUTH_SECRET).
  BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdefghijklmnopqrstuv",
  ORIGIN: E2E_ORIGIN,
  PORT: String(E2E_PORT),
  HOST: "127.0.0.1",
  DATABASE_PATH: E2E_DB,
  UPLOAD_DIR: `${E2E_DIR}/uploads`,
  // No outbound Nominatim requests from tests (DESIGN §4).
  GEOCODE: "off",
  // No tile downloads/extractions from tests (DESIGN §7); the map still
  // serves whatever tiles.sqlite happens to exist (none in the throwaway DB).
  TILES: "off",
};

const child = spawn("bun", ["run", entry], {
  env: runtimeEnv,
  stdio: ["ignore", "pipe", "inherit"],
});

let worker: ReturnType<typeof spawn> | undefined;
function startWorker() {
  if (worker) return;
  worker = spawn("bun", ["run", resolve(import.meta.dirname, "../../server/scripts/worker.ts")], {
    env: runtimeEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  worker.stdout.on("data", (chunk: Buffer) => process.stdout.write(`[worker] ${chunk}`));
}

child.stdout.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  const link = text.match(/\[bootstrap\] (http\S+\/invite\/\S+)/)?.[1];
  if (link) writeFileSync(BOOTSTRAP_LINK_FILE, link);
  // The bootstrap line is printed after migrations, so the worker can safely
  // open the same database from here on.
  if (text.includes("[bootstrap]")) startWorker();
});

const stop = () => {
  child.kill("SIGTERM");
  worker?.kill("SIGTERM");
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => {
  worker?.kill("SIGTERM");
  process.exit(code ?? 0);
});
