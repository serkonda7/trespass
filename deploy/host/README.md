# Host setup

- **No `bootstrap.sh`**: Hausmeister's Phase 0 already set up the VPS (Docker,
  ufw, deSEC, host Tailscale SSH).
- **No `tailscale-policy.hujson`**: the tailnet has one policy file (Hausmeister
  or infra repo). Add `tag:trespass` owner, grants and tests from DESIGN §8.3
  there.
- Share only the `trespass` node with urbex friends, never `hausmeister`.
