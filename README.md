# Trespass

Private log of abandoned places: map, journal, photos, history, trip planning and a
research inbox. Design: [DESIGN.md](DESIGN.md). Current phase: **MVP implemented**
(DESIGN §12): login with passkeys, invites, roles and groups; locations with fuzzed
public points, grants and coordinate privacy; map with self-hosted tiles and automatic
tile regions; visits and journal; photos; search; ZIP export. **v1.1 implemented**:
history with sources and archive.org copies, comments, equipment and packing templates,
trips with a route preview. **v1.3 implemented**: research with search areas,
OpenStreetMap/Wikidata scans, web enrichment with checked quotes and a monthly LLM
budget, and a weekly watch, all into a review inbox. Next: Phase 0 on the VPS, then v1.2. The infra runbook is [docs/PHASE0.md](docs/PHASE0.md).

Infra and stack follow [Hausmeister](https://github.com/serkonda7/hausmeister)
(Bun + TanStack Start, SQLite, Better Auth, Tailscale sidecar + Caddy DNS-01 via deSEC,
Litestream + restic to B2). Both apps run on the same VPS as separate stacks, on separate
subdomains and separate tailnet nodes.

Bun workspaces managed by Turborepo: `apps/client` (TanStack Start app), `apps/server`
(server code, worker, migrations) and `packages/shared` (contract types and i18n).
`bun install && bun run check && bun run build` builds everything. See
[AGENTS.md](AGENTS.md) for the layout and conventions.
