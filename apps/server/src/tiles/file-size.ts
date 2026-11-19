// Pure file-size helper shared by the web-side budget display and the
// worker-only writer. Keeping it separate prevents writer.ts (the read-write
// MBTiles handle) from being pulled into the web bundle.
import { existsSync, statSync } from "node:fs";

/** File size of the MBTiles file including its WAL (conservative for budgets). */
export function tilesFileSize(path: string): number {
  let total = 0;
  for (const p of [path, `${path}-wal`]) {
    if (existsSync(p)) total += statSync(p).size;
  }
  return total;
}
