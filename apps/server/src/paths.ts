import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The repository root: the nearest directory at or above `start` whose
 * package.json declares workspaces (in the Docker image that is /app).
 * Dev defaults such as ./data hang off it, so `bun run worker` at the root and
 * `vite dev` inside apps/client open the same database. Falls back to `start`.
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
