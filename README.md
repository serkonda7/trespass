# Trespass

Private log of abandoned places: map, journal, photos, history, trip planning and a
research inbox. Design: [DESIGN.md](DESIGN.md). Current phase: **design only**; the
infra runbook is [docs/PHASE0.md](docs/PHASE0.md).

Infra and stack follow [Hausmeister](https://github.com/serkonda7/hausmeister)
(Bun + TanStack Start, SQLite, Better Auth, Tailscale sidecar + Caddy DNS-01 via deSEC,
Litestream + restic to B2). Both apps run on the same VPS as separate stacks, on separate
subdomains and separate tailnet nodes.

No code or infra files yet, on purpose.
