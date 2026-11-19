// Read-only access to the MBTiles SQLite file (DESIGN §7.1). The web process
// never writes tiles: only the worker/image build creates the file. The handle
// is opened lazily so a file that appears later (first region download) is
// picked up without a restart, and a missing file simply yields no tile (204).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getEnv } from "../env";

export type TileReader = { path: string; db: Database | null };

export function createTileReader(path: string): TileReader {
  return { path, db: null };
}

export function closeTileReader(reader: TileReader): void {
  reader.db?.close();
  reader.db = null;
}

/** A single reader per process, resolved from TILES_PATH on first use. */
let appReader: TileReader | undefined;

export function getAppTileReader(): TileReader {
  appReader ??= createTileReader(getEnv().TILES_PATH);
  return appReader;
}

/** For tests that change TILES_PATH between cases. */
export function resetAppTileReader(): void {
  if (appReader) closeTileReader(appReader);
  appReader = undefined;
}

/**
 * One tile's raw bytes, or null when there is no file/table/row. Errors from a
 * broken or incomplete MBTiles file are treated as a missing tile, never as a
 * 500 — a map must not go down because a background extract failed.
 */
export function readTile(reader: TileReader, z: number, x: number, y: number): Uint8Array | null {
  if (reader.db === null) {
    if (!existsSync(reader.path)) return null;
    try {
      reader.db = new Database(reader.path, { readonly: true });
    } catch {
      return null;
    }
  }
  // MBTiles stores TMS rows; MapLibre asks for XYZ.
  const row = 2 ** z - 1 - y;
  try {
    const found = reader.db
      .query(
        "SELECT tile_data AS data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
      )
      .get(z, x, row) as { data: Uint8Array | null } | undefined;
    if (!found?.data || found.data.length === 0) return null;
    return new Uint8Array(found.data);
  } catch {
    return null;
  }
}
