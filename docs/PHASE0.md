# Phase 0 runbook: infrastructure

Goal: a "Hallo" page with a MapLibre map at `https://lp.example.de`, with a real
certificate, reachable only over Tailscale (by me and by friends the node is shared
with, but not by them on Hausmeister), with tested backups. See DESIGN.md §8.

This runbook assumes **Hausmeister Phase 0 is done** on the same VPS: the deSEC
account, Docker, ufw and host Tailscale SSH already exist. Steps that would repeat
Hausmeister's runbook point to it instead of copying it. Steps marked 🧑 are manual.

> Docs only for now. The `deploy/` files referenced below don't exist yet. They are
> created at the start of Phase 0 by **porting** Hausmeister's `deploy/` (see step 0).

---

## 0. Port the deploy files (before any step below)

Copy Hausmeister's `deploy/` and change:

| File | Change |
| --- | --- |
| `compose.yaml` | `name: trespass`; tailscale `hostname: trespass`, `--advertise-tags=tag:trespass`; add the `worker` service (same image, `bun run worker`, same `./data`); optional `searxng` under `profiles: [research]`; `mem_limit` on every service (DESIGN §8.4) |
| `Caddyfile` | `request_body max_size 110MB` (photos); everything else stays as it is |
| `litestream.yml`, `.env.backup.example` | New bucket name |
| `.env.example` | `DOMAIN=lp.example.de`; add `ANTHROPIC_API_KEY`, `VAPID_*`, `SMTP_URL`, `NTFY_URL`, `HEALTHCHECK_URL` |
| `host/desec-setup.sh` | Make the token name a parameter (`trespass-caddy-acme`) |
| `check-dns.sh` | Make the test record name a parameter |
| `host/install-timers.sh`, `backup-uploads.sh`, `restore-test.sh` | Unit names `trespass-*`; backup at **04:15**, restore test on the 2nd of the month at 05:00; the restore test compares location and photo counts; path `/opt/trespass` |
| `host/bootstrap.sh` | **Not needed**, the host is already set up |
| `host/tailscale-policy.hujson` | Keep **one** policy file for the tailnet, in the Hausmeister repo or a separate infra repo, with the additions from DESIGN §8.3 |

## 1. Zone `lp.example.de` at deSEC + restricted token (~5 min)

Same as Hausmeister PHASE0 §1, in the **existing** deSEC account:

```sh
deploy/host/desec-setup.sh lp.example.de --token
```

Store the token in the password manager as "trespass DESEC_TOKEN". It is separate from
Hausmeister's token.

## 2. Delegate the subdomain at Strato 🧑

Same as Hausmeister PHASE0 §2, for `lp`: _Domainverwaltung → example.de → Subdomains →
`lp` → DNS server_ `ns1.desec.io`, `ns2.desec.org`. Don't touch `sub` or `example.de`.

## 3. Verify

```sh
cd deploy && printf 'DOMAIN=lp.example.de\nDESEC_TOKEN=%s\n' 'the-token' > .env
./check-dns.sh --write-test
```

All checks should be green except A, which is set in step 7. Also re-run Hausmeister's
`check-dns.sh` to confirm nothing changed there.

## 4. Tailscale 🧑

1. _Access controls_: add `tag:trespass` to `tagOwners` and the grants and tests
   from DESIGN §8.3. Save; the tests must pass.
2. _Keys_: a **non-reusable**, pre-approved auth key, tag `tag:trespass`, expiring in 1 day.

## 5. VPS check 🧑

The VPS already exists. Check that it has room for a second stack:

```sh
free -h; df -h /opt; nproc
docker stats --no-stream            # Hausmeister's current use
```

- Less than 4 GB RAM in total → upgrade the Strato plan first (DESIGN §8.4).
- Not enough disk for the photos expected in year one, plus ~10 GB of tiles → add
  a volume for `data/uploads`.
- Optional, on the Hausmeister side: add `mem_limit` to its containers.

Then put the repo in place:

```sh
sudo install -d -o admin -g admin /opt/trespass
rsync -a --exclude node_modules --exclude .output ./ admin@<vps>:/opt/trespass/
```

## 6. Object storage + start the stack 🧑

1. B2: a **new private bucket** (e.g. `example-trespass`, encryption on, lifecycle
   30 days for hidden files) and a key **for this bucket only**. Never reuse
   Hausmeister's key.
2. On the VPS:
   ```sh
   cd /opt/trespass/deploy
   cp .env.example .env && cp .env.backup.example .env.backup && chmod 600 .env .env.backup
   # fill in: DESEC_TOKEN, TS_AUTHKEY / S3_*, RESTIC_PASSWORD (new: openssl rand -base64 32)
   mkdir -p data/db data/uploads data/tiles data/cache ts-state && sudo chown -R 1000:1000 data
   docker compose up -d --build
   docker compose exec tailscale tailscale ip -4      # → 100.a.b.c
   ```
3. Remove `TS_AUTHKEY` from `.env`.
4. Check that both sidecars are up and separate:
   `docker compose -p hausmeister ps` and `docker compose -p trespass ps`. The tailnet
   admin page shows the two nodes `hausmeister` and `trespass` with different IPs.

## 7. Point the domain at the tailnet IP

```sh
deploy/host/desec-setup.sh lp.example.de --a 100.a.b.c
./check-dns.sh                        # all green
```

## 8. TLS: staging → production

Same as Hausmeister PHASE0 §8, with `lp.example.de`. Finish by switching to production
`ACME_CA` and checking for a valid lock on the phone.

## 9. Runtime checks (in the production image)

Run these checks once by hand, then add them to CI:

```sh
docker compose exec app bun -e '<checks>'
```

| Check | Expected |
| --- | --- |
| SQLite version ≥ 3.45, FTS5 `trigram remove_diacritics` works | required |
| R\*Tree module available | nice to have (DESIGN §9 notes) |
| `sharp` loads; HEIC decode | HEIC: note yes or no; DESIGN §5.3 follows the result |
| `exifr` reads GPS from a sample JPEG | required |
| `pmtiles` CLI present in the worker image | required |
| Offline time-zone lookup for (35.68, 139.69) → `Asia/Tokyo` | required |

## 10. Tile smoke test

1. Find the newest Protomaps daily build and note its date.
2. In the worker container, extract **world z0–6** → note its size.
3. Extract **two 20 × 20 km boxes at z7–15**, one urban and one rural. Note the sizes,
   and use them to set the default `tile_budget_mb` (DESIGN §7.3).
4. Load all three into `data/tiles/tiles.sqlite` (MBTiles layout).
5. The "Hallo" page shows a MapLibre map from `/tiles/{z}/{x}/{y}.mvt` with
   self-hosted glyphs and sprites. In the browser's dev tools there must be **no
   requests to third-party hosts**.

## 11. Backups + restore test

```sh
sudo deploy/host/install-timers.sh        # trespass-backup 04:15, trespass-restore-test monthly
sudo systemctl start trespass-backup
./restore-test.sh                         # must end with "RESTORE TEST OK"
systemctl list-timers 'hausmeister-*' 'trespass-*'
```

Store `.env`, `.env.backup` and `ts-state/` in the password manager.

## 12. Isolation test 🧑

1. Share node `trespass` with one friend's Tailscale account (_Machines →
   trespass → Share_).
2. From the friend's device: `https://lp.example.de` loads, `https://sub.example.de`
   **does not**.
3. From a family member's device (in `group:family`): `sub` loads, `lp` **does not**.
4. From outside: `nmap -Pn <VPS public IP>` shows nothing open.
5. Note the share list, to review it every quarter.

---

## Done when

- [ ] `check-dns.sh --write-test` is all green for `lp.example.de`, and Hausmeister's checks are still green
- [ ] `https://lp.example.de` shows "Hallo" + a map with a trusted certificate, from tailnet devices only
- [ ] The isolation test (step 12) passes in all four directions
- [ ] The runtime checks (step 9) are recorded, and DESIGN.md is updated where results differ
- [ ] Tile sizes are measured and `tile_budget_mb` is decided
- [ ] Litestream is replicating to the **new** bucket; `restore-test.sh` passes; both projects' timers are listed
- [ ] Every container in the trespass stack has a `mem_limit`; the host has ≥ 4 GB RAM
- [ ] Secrets are stored in the password manager, separately from Hausmeister's
