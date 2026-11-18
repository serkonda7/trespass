# App + worker image, built on the VPS by compose (`build: ..`).
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4-slim
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
