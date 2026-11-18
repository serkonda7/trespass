# Trespass

Private log of abandoned places: map, journal, photos, history, trip planning and a
research inbox. Design: [DESIGN.md](DESIGN.md). Current phase: **MVP implemented**
(DESIGN §12): login with passkeys, invites, roles and groups; locations with fuzzed
public points, grants and coordinate privacy; map with self-hosted tiles and automatic
tile regions; visits and journal; photos; search; ZIP export. Next: Phase 0 on the
VPS, then v1.1. The infra runbook is [docs/PHASE0.md](docs/PHASE0.md).

Infra and stack follow [Hausmeister](https://github.com/serkonda7/hausmeister)
(Bun + TanStack Start, SQLite, Better Auth, Tailscale sidecar + Caddy DNS-01 via deSEC,
Litestream + restic to B2). Both apps run on the same VPS as separate stacks, on separate
subdomains and separate tailnet nodes.

`bun install && bun run check && bun run build` builds and tests the app (`bun run e2e` for Playwright). See
[AGENTS.md](AGENTS.md) for the layout and conventions.
