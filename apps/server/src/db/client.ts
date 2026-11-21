import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { getEnv } from "../env";
import { workspaceRoot } from "../paths";
import * as schema from "./schema";

export type AppDb = BunSQLiteDatabase<typeof schema> & { $client: Database };
/** The `tx` handed to `db.transaction((tx) => …)`. */
export type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
/** Functions that work both standalone and inside a caller's transaction take this. */
export type DbOrTx = AppDb | AppTx;

/** apps/server/drizzle below the repo root; `import.meta.dir` only as fallback (unusable when bundled). */
export function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  const fromRoot = join(workspaceRoot(), "apps", "server", "drizzle");
  if (existsSync(join(fromRoot, "meta", "_journal.json")) || !import.meta.dir) return fromRoot;
  return resolve(import.meta.dir, "../../drizzle");
}

/**
 * Opens a SQLite database with the app's pragmas and applies all pending
 * migrations. `path` may be ":memory:".
 */
export function openDatabase(path: string, opts: { snapshotBeforeMigrate?: boolean } = {}): AppDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  const db = drizzle({ client: sqlite, schema }) as AppDb;

  const folder = migrationsDir();
  if (opts.snapshotBeforeMigrate && path !== ":memory:") snapshotIfPending(sqlite, path, folder);
  migrate(db, { migrationsFolder: folder });
  return db;
}

/** How many pre-migration snapshots `snapshotIfPending` keeps per database. */
export const KEEP_SNAPSHOTS = 3;

/**
 * Before migrating an existing DB, snapshot it to `<db>.pre-migrate-<ISO>.bak`
 * (newest KEEP_SNAPSHOTS kept; local only, not replicated). DESIGN §8.6.
 */
function snapshotIfPending(sqlite: Database, path: string, folder: string) {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  const hasTable = sqlite
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  const hasData = sqlite.query("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get();
  if (!hasData) return; // fresh database, nothing to protect
  const applied = hasTable
    ? (sqlite.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n
    : 0;
  if (applied >= journal.entries.length) return;
  const target = `${path}.pre-migrate-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  sqlite.query("VACUUM INTO ?").run(target);
  console.log(`[db] snapshot before migrations: ${target}`);
  for (const old of pruneSnapshots(path, KEEP_SNAPSHOTS)) {
    console.log(`[db] removed old snapshot: ${old}`);
  }
}

/**
 * Deletes all but the newest `keep` pre-migration snapshots of `path`
 * (the ISO timestamp in the name sorts chronologically). Returns the removed paths.
 */
export function pruneSnapshots(path: string, keep: number): string[] {
  const dir = dirname(path);
  const prefix = `${basename(path)}.pre-migrate-`;
  const snaps = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".bak"))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const f of snaps.slice(keep)) {
    rmSync(join(dir, f), { force: true });
    removed.push(join(dir, f));
  }
  return removed;
}

// On globalThis: the Nitro startup plugin and the lazily loaded app bundle may
// each carry their own copy of this module, and both must share one connection
// (so shutdown can close it).
const G = globalThis as unknown as { __trespassDb?: AppDb };

/** Process-wide DB (DATABASE_PATH). First call opens, migrates and records a `boots` row. */
export function getDb(): AppDb {
  if (G.__trespassDb) return G.__trespassDb;
  const db = openDatabase(getEnv().DATABASE_PATH, { snapshotBeforeMigrate: true });
  db.insert(schema.boots).values({ at: new Date().toISOString() }).run();
  G.__trespassDb = db;
  return db;
}

/** Closes the process DB at shutdown after a PASSIVE checkpoint (never disturbs Litestream). */
export function closeDb(): boolean {
  const db = G.__trespassDb;
  if (!db) return false;
  G.__trespassDb = undefined;
  closeDatabase(db);
  return true;
}

/** PASSIVE checkpoint + `close(true)` (plain close() defers while cached statements live). */
export function closeDatabase(db: AppDb) {
  try {
    db.$client.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } finally {
    try {
      db.$client.close(true);
    } catch {
      db.$client.close(); // a statement is still running: close when it ends
    }
  }
}
