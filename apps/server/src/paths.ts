import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Nearest dir at/above `start` whose package.json has workspaces (/app in
 * Docker), so every workspace shares ./data. Falls back to `start`.
 */
export function workspaceRoot(start = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ("workspaces" in JSON.parse(readFileSync(pkg, "utf8"))) return dir;
      } catch {
        // unreadable package.json: keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
