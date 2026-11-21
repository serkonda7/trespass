// Consistent export view: own read-only connection in one read transaction
// (WAL grows meanwhile). Blobs gc'd meanwhile are marked missing. In-memory
// DBs can't be reopened, so they are read directly.
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { AppDb } from "../db/client";
import * as schema from "../db/schema";

export type Snapshot = { db: AppDb; isolated: boolean; close(): void };

function fileOf(db: AppDb): string | null {
  const name = db.$client.filename;
  return !name || name === ":memory:" ? null : name;
}

export function openSnapshot(db: AppDb): Snapshot {
  const file = fileOf(db);
  if (!file) return { db, isolated: false, close() {} };
  const sqlite = new Database(file, { readonly: true, strict: true });
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec("PRAGMA query_only = ON");
    sqlite.exec("BEGIN");
    // A deferred transaction takes its snapshot at the first read.
    sqlite.query("SELECT count(*) FROM locations").get();
  } catch (err) {
    sqlite.close();
    throw err;
  }
  const snap = drizzle({ client: sqlite, schema }) as AppDb;
  let closed = false;
  return {
    db: snap,
    isolated: true,
    close() {
      if (closed) return;
      closed = true;
      try {
        sqlite.exec("COMMIT");
      } catch {
        // nothing to commit in a read transaction that failed
      }
      sqlite.close();
    },
  };
}
