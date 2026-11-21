// Nitro plugin, once per process: validate env, migrate, seed, print the
// first-admin invite. The worker is a separate process (`bun run worker`).
// Package imports only: bundled outside Vite's `~` alias.

import { bootstrapInviteAtStartup } from "@trespass/server/auth/invites";
import { getDb } from "@trespass/server/db/client";
import { getEnv } from "@trespass/server/env";
import { seedCategories } from "@trespass/server/locations/categories";
import { ensureSearchIndex } from "@trespass/server/search/indexer";
import { installGracefulShutdown } from "@trespass/server/shutdown";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  try {
    const env = getEnv();
    // The process-wide connection (snapshot + migrations on first open), shared
    // with the app bundle through globalThis; shutdown closes it.
    const db = getDb();
    // The ten categories are seeded idempotently at startup, so admin edits to
    // their names/icons survive while fresh installations get the defaults.
    seedCategories(db);
    // Backfill/repair the FTS index (DESIGN §5.9) after migrations and restores.
    // Idempotent; writes keep it in step afterwards.
    if (ensureSearchIndex(db)) console.log("[search] index was out of step; rebuilt");
    // First admin (README "First admin"): while there are no users at all,
    // print a fresh one-time admin invite link. Nothing is printed afterwards.
    const link = bootstrapInviteAtStartup(db, env.ORIGIN);
    if (link) {
      console.log(
        `[bootstrap] No users yet. Create the first admin (link valid 24 h, usable once):\n[bootstrap] ${link}`,
      );
    }
    // SIGTERM/SIGINT: drain requests, checkpoint and close SQLite, exit 0.
    if (env.isProduction) installGracefulShutdown(nitroApp.hooks);
  } catch (err) {
    console.error("[startup] fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
});
