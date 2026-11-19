# App + worker image, built on the VPS by compose (`build: ..`).
FROM oven/bun:1.4.4 AS build
WORKDIR /app
# Workspace manifests first, so the install layer survives source edits.
COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY . .
# Self-hosted glyphs/sprites and MapLibre's CSP worker (apps/client/public/map/ is gitignored).
RUN bun run map-assets
# turbo: Paraglide messages (packages/shared), then the client build (apps/client/.output).
RUN bun run build

# Production-only install: the runtime needs the web bundle's externals and the
# worker's server/shared dependencies, but none of the build/test tools. A separate
# stage keeps `build`'s dev install (turbo, vite, Paraglide compiler) intact.
FROM oven/bun:1.4.4 AS deps
WORKDIR /app
# Workspace manifests first, so the install layer survives source edits.
COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# --production skips every workspace's devDependencies but still creates the
# @trespass/* links with the hoisted linker (bunfig.toml); all three workspaces
# are installed so the web bundle's externals resolve alongside the worker's.
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim
# go-pmtiles CLI for the worker (DESIGN §7/§10). Pinned release; the tarball's
# sha256 was computed from the pinned Linux_x86_64 asset on 2026-11-18 (that
# release publishes no checksums file). Bump version AND hash together.
ARG PMTILES_VERSION=1.31.2
ARG PMTILES_SHA256=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f
RUN bun -e 'const r = await fetch(`https://github.com/protomaps/go-pmtiles/releases/download/v${Bun.env.PMTILES_VERSION}/go-pmtiles_${Bun.env.PMTILES_VERSION}_Linux_x86_64.tar.gz`); if (!r.ok) throw new Error(String(r.status)); await Bun.write("/tmp/pmtiles.tar.gz", new Uint8Array(await r.arrayBuffer()))' \
 && echo "${PMTILES_SHA256}  /tmp/pmtiles.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles \
 && rm /tmp/pmtiles.tar.gz \
 && pmtiles version
WORKDIR /app
# Root manifest: workspace root (data/migration lookup) and the ops scripts
# (`bun run worker`, `create-admin-invite`, `healthcheck`).
COPY --from=build /app/package.json /app/bunfig.toml ./
COPY --from=build /app/apps/client/.output ./apps/client/.output
COPY --from=build /app/apps/client/scripts/healthcheck.ts ./apps/client/scripts/healthcheck.ts
# The standalone worker (`bun run worker`) runs apps/server's TS sources (with
# drizzle/ migrations) and imports packages/shared, including the generated
# Paraglide messages, so both workspaces ship as source.
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages/shared ./packages/shared
# Production-only hoisted dependency tree (bunfig.toml), including the
# @trespass/* workspace links needed by the worker; no dev tools ship.
COPY --from=deps /app/node_modules ./node_modules
# Smoke test: sharp's native binaries work in the runtime image.
RUN bun -e 'const s = require("sharp"); await s({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp().toBuffer(); console.log("sharp", s.versions.sharp, "ok")'
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["bun", "run", "healthcheck"]
CMD ["bun", "run", "apps/client/.output/server/index.mjs"]
