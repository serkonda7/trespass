import { fileURLToPath } from "node:url";
import { tablerIcons } from "@serkonda7/solid-components/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import viteSolid from "vite-plugin-solid";

// NITRO_OUTPUT_DIR builds somewhere other than .output.
const outDir = process.env.NITRO_OUTPUT_DIR;

export default defineConfig({
  server: { port: 3000 },
  // Fonts always ship as files: Vite would inline small subsets as data: URLs,
  // which the CSP (font-src 'self') blocks. Set for every environment so the
  // client and SSR builds emit the same stylesheet hash.
  build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) },
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  environments: {
    client: {
      // Dev only: vite-plugin-solid keeps packages with a `solid` export
      // condition out of dependency pre-bundling, so the browser would fetch
      // better-auth's client as ~170 separate modules on every page load.
      // It ships plain JS (no JSX), so pre-bundling it is safe.
      // The map libraries are only reached through dynamic imports, so Vite
      // would discover them late, re-optimize and reload the page (back to
      // "Lädt …" on forms). Listing them pre-bundles them at startup.
      optimizeDeps: {
        include: [
          "better-auth/client",
          "better-auth/client/plugins",
          "better-auth/solid",
          "maplibre-gl",
          "@protomaps/basemaps",
        ],
      },
      build: {
        rolldownOptions: {
          output: {
            // Zod and ~/lib/zod-config.ts share one chunk, so `jitless` is set the moment Zod loads.
            // Otherwise a shared chunk that creates schemas at load can run before the entry's z.config() and trip the CSP (no 'unsafe-eval').
            codeSplitting: {
              groups: [
                {
                  name: "zod",
                  test: /[\\/]node_modules[\\/]zod[\\/]|[\\/]src[\\/]lib[\\/]zod-config\.ts$/,
                },
              ],
            },
          },
        },
      },
    },
  },
  plugins: [
    // Rewrites `import { IconX } from "@tabler/icons-solidjs"` to per-icon
    // modules. Without it, dev loads all ~6000 icons through the barrel (the
    // `solid` export condition serves unbundled source); it also keeps the
    // build from parsing the barrel. Must run before vite-plugin-solid.
    tablerIcons(),
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: "bun",
      plugins: ["./src/nitro/startup.ts"],
      // Glyphs/sprites change only with `map-assets`: cache a week. The MapLibre
      // worker must match the bundle, so it keeps ETag revalidation.
      routeRules: {
        "/map/fonts/**": { headers: { "cache-control": "public, max-age=604800" } },
        "/map/sprites/**": { headers: { "cache-control": "public, max-age=604800" } },
      },
      // Don't copy sharp (~19 MB) into .output: it resolves from the hoisted root
      // node_modules. `!sharp` stops tracing; `rolldownConfig.external` keeps the
      // import bare.
      traceDeps: ["!sharp"],
      rolldownConfig: { external: ["sharp"] },
      ...(outDir ? { output: { dir: outDir }, buildDir: `${outDir}/.nitro` } : {}),
    }),
    viteSolid({ ssr: true }),
  ],
});
