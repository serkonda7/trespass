# Host setup

The VPS is already set up by Hausmeister's Phase 0 (Docker, ufw, deSEC account,
host Tailscale SSH), so there is no `bootstrap.sh` here.

There is deliberately no `tailscale-policy.hujson` either: the tailnet has
**one** policy file, kept in the Hausmeister repo or a separate infra repo.
Add the `tag:trespass` tag owner, grants and tests from DESIGN §8.3 to that one
policy. Share only the `trespass` node with urbex friends — never `hausmeister`.
