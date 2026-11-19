// Writer for the single MBTiles file (DESIGN §7.1). Only the worker opens this
// in read-write mode; the web app's reader (./store.ts) stays read-only. WAL
// mode plus a lazily opened reader means newly written tiles are visible to the
// app without a restart. Transactions are short (<= 1000 rows) because
// bun:sqlite is synchronous and the worker shares the database with the app.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TileEntry } from "./types";

export { tilesFileSize } from "./file-size";

export const BATCH_SIZE = 1000;

export type TileWriter = {
  path: string;
  /** Upserts entries, returns the number of rows written. XYZ y -> TMS row. */
  writeTiles(entries: readonly TileEntry[]): number;
  /** Deletes XYZ entries (used by pruning). */
  deleteTiles(entries: readonly TileEntry[]): number;
  setMetadata(values: Readonly<Record<string, string>>): void;
  getMetadata(): Record<string, string>;
  /** Sum of all tile_data lengths in the file (approximate region sizes). */
  totalBytes(): number;
  tileCount(): number;
  close(): void;
};

export const xyzToTms = (z: number, y: number) => 2 ** z - 1 - y;

function valid(e: TileEntry): boolean {
  return (
    Number.isInteger(e.z) &&
    e.z >= 0 &&
    Number.isInteger(e.x) &&
    e.x >= 0 &&
    e.x < 2 ** e.z &&
    Number.isInteger(e.y) &&
    e.y >= 0 &&
    e.y < 2 ** e.z &&
    e.data instanceof Uint8Array
  );
}

export function openTileWriter(path: string): TileWriter {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
    CREATE TABLE IF NOT EXISTS tiles (
      zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tiles_idx
      ON tiles (zoom_level, tile_column, tile_row);
  `);
  const upsert = db.query(`
    INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)
    ON CONFLICT (zoom_level, tile_column, tile_row) DO UPDATE SET tile_data = excluded.tile_data
  `);
  const remove = db.query(
    "DELETE FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
  );
  const setMeta = db.query("INSERT INTO metadata (name, value) VALUES (?, ?)");
  const delMeta = db.query("DELETE FROM metadata WHERE name = ?");

  function batches<T>(items: readonly T[], fn: (item: T) => void): number {
    let n = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      db.transaction(() => {
        for (const item of chunk) {
          fn(item);
          n++;
        }
      })();
    }
    return n;
  }

  return {
    path,
    writeTiles(entries) {
      return batches(entries.filter(valid), (e) =>
        upsert.run(e.z, e.x, xyzToTms(e.z, e.y), Buffer.from(e.data)),
      );
    },
    deleteTiles(entries) {
      return batches(entries.filter(valid), (e) => remove.run(e.z, e.x, xyzToTms(e.z, e.y)));
    },
    setMetadata(values) {
      db.transaction(() => {
        for (const [name, value] of Object.entries(values)) {
          delMeta.run(name);
          setMeta.run(name, String(value));
        }
      })();
    },
    getMetadata() {
      const rows = db.query("SELECT name, value FROM metadata").all() as {
        name: string;
        value: string;
      }[];
      return Object.fromEntries(rows.map((r) => [r.name, r.value]));
    },
    totalBytes() {
      return (
        (
          db.query("SELECT COALESCE(SUM(LENGTH(tile_data)), 0) AS n FROM tiles").get() as {
            n: number;
          }
        ).n ?? 0
      );
    },
    tileCount() {
      return (db.query("SELECT COUNT(*) AS n FROM tiles").get() as { n: number }).n ?? 0;
    },
    close() {
      db.close(true);
    },
  };
}
