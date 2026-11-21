import { fileURLToPath } from "node:url";
import { tablerIcons } from "@serkonda7/solid-components/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import viteSolid from "vite-plugin-solid";

// NITRO_OUTPUT_DIR builds somewhere other than .output (used by `bun run e2e`,
// so its build never clobbers the shared .output).
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
      optimizeDeps: {
        include: ["better-auth/client", "better-auth/client/plugins", "better-auth/solid"],
      },
      build: {
        rolldownOptions: {
          output: {
            // Zod and src/lib/zod-config.ts share one chunk, so `jitless` is set the moment Zod loads.
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
      // Map glyphs and sprites (public/map, from `bun run map-assets`) are
      // unhashed but only change with a new basemaps-assets download: cache
      // them for a week instead of revalidating every PBF on each map load.
      // The MapLibre worker is not listed: it must match the bundled library
      // version, so it keeps the default ETag revalidation.
      routeRules: {
        "/map/fonts/**": { headers: { "cache-control": "public, max-age=604800" } },
        "/map/sprites/**": { headers: { "cache-control": "public, max-age=604800" } },
      },
      // Nitro traces `sharp` as a native package and copies it plus @img/* (~19 MB)
      // into .output. The hoisted root node_modules (bunfig.toml) already ships it,
      // and both `bun run start` and Docker resolve bare imports from there.
      // `!sharp` stops tracing; the trace pattern also drives externalization, so
      // `rolldownConfig.external` keeps the import bare instead of bundling sharp.
      // Not `builtinModules`: that is only for modules the runtime provides.
      traceDeps: ["!sharp"],
      rolldownConfig: { external: ["sharp"] },
      ...(outDir ? { output: { dir: outDir }, buildDir: `${outDir}/.nitro` } : {}),
    }),
    viteSolid({ ssr: true }),
  ],
});
