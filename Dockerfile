# App + worker image, built on the VPS by compose (`build: ..`).
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Self-hosted glyphs/sprites and MapLibre's CSP worker (public/map/ is gitignored).
RUN bun run map-assets
RUN bun run build

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
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
# The standalone worker (`bun run worker`) imports the TS server modules and
# needs the same packages as the app, so keep the full dependency tree here.
COPY --from=build /app/node_modules ./node_modules
# Smoke test: sharp's native binaries work in the runtime image.
RUN bun -e 'const s = require("sharp"); await s({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp().toBuffer(); console.log("sharp", s.versions.sharp, "ok")'
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["bun", "run", "scripts/healthcheck.ts"]
CMD ["bun", "run", ".output/server/index.mjs"]
