// Downloads the Protomaps basemap glyphs/sprites into public/map/ and copies
// MapLibre's standalone worker there. Run with `bun run map-assets` (the Docker
// build and `bun run e2e` do it automatically). public/map/ is gitignored: the
// map still works without these files (pins, no labels), so network failures
// are warnings, never a failed build. No third-party URL appears in the app.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ASSETS = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main";
const ROOT = join(import.meta.dir, "..", "public", "map");
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
// Covers Latin (incl. umlauts), Greek, Cyrillic and common symbols. MapLibre
// asks for the range that contains each glyph; missing ranges just omit labels.
const RANGES = [
  "0-255",
  "256-511",
  "512-767",
  "768-1023",
  "1024-1279",
  "1280-1535",
  "1536-1791",
  "1792-2047",
  "2048-2303",
  "2304-2559",
  "2560-2815",
  "3584-3839",
  "3840-4095",
  "4096-4351",
  "8192-8447",
];
const SPRITES = ["dark.json", "dark.png", "dark@2x.json", "dark@2x.png"];

function keep(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

async function download(url: string, target: string) {
  if (keep(target)) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.warn(`[map-assets] skipped ${url}: ${String(err)}`);
  }
}

async function main() {
  mkdirSync(ROOT, { recursive: true });
  for (const font of FONTS) {
    for (const range of RANGES) {
      const name = `${range}.pbf`;
      await download(
        `${ASSETS}/fonts/${encodeURIComponent(font)}/${encodeURIComponent(name)}`,
        join(ROOT, "fonts", font, name),
      );
    }
  }
  for (const sprite of SPRITES) {
    await download(`${ASSETS}/sprites/v4/${sprite}`, join(ROOT, "sprites", "v4", sprite));
  }

  // maplibre-gl creates workers from a blob: URL by default, which a strict
  // CSP (worker-src 'self') blocks. This file is self-contained and is loaded
  // via maplibregl.setWorkerUrl() from the same origin instead.
  // Resolved through the package, so it works with node_modules hoisted to the repo root.
  const workerSrc = join(
    dirname(Bun.resolveSync("maplibre-gl/package.json", import.meta.dir)),
    "dist",
    "maplibre-gl-worker.mjs",
  );
  const workerDest = join(ROOT, "maplibre-gl-worker.mjs");
  if (existsSync(workerSrc)) {
    mkdirSync(ROOT, { recursive: true });
    await Bun.write(workerDest, await Bun.file(workerSrc).arrayBuffer());
  } else {
    console.warn("[map-assets] maplibre-gl worker missing; install dependencies first");
  }
  console.log("[map-assets] done");
}

await main();
