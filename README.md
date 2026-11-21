# Trespass

Private log of abandoned places: map, journal, photos, history, trip planning
and a research inbox. Design: [DESIGN.md](DESIGN.md).

## Status

- **MVP** (DESIGN §12): passkey login, invites, roles, groups; locations with
  grants; self-hosted map tiles; visits and journal; photos; search; ZIP export.
- **v1.1**: history with archive.org sources, comments, equipment and packing
  templates, trips with route preview.
- **v1.3**: research — search areas, OSM/Wikidata scans, web enrichment with
  checked quotes, monthly LLM budget, weekly watch, review inbox.
- **Next**: Phase 0 on the VPS ([docs/PHASE0.md](docs/PHASE0.md)), then v1.2.

## Infra

Same as [Hausmeister](https://github.com/serkonda7/hausmeister): Bun + TanStack
Start, SQLite, Better Auth, Tailscale sidecar + Caddy DNS-01 via deSEC,
Litestream + restic to B2. Separate stack, subdomain and tailnet node on the
same VPS.

## Build

```sh
bun install && bun run check && bun run build
```

Layout and conventions: [AGENTS.md](AGENTS.md).
