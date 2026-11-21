# Agent briefing

Trespass: private urbex log. Read DESIGN.md first.

- **Stack**: Bun, TanStack Start (Solid, SSR, Nitro), SQLite (`bun:sqlite` +
  Drizzle), Better Auth (password + passkeys, invite-only), Tailwind 4 +
  Kobalte, Paraglide (German only), Biome.
- **Dependencies** are pinned. Add one only on purpose:
  `bun add --exact <pkg> --cwd <workspace>`.
- **Status**: MVP, v1.1 and v1.3 done; v1.2 (push, check-in, offline) not yet.

## Workspaces

Imports flow `client → server → shared`; never upward.

- `apps/client`: routes, components, client `lib/`, styles. Its build bundles
  the server.
- `apps/server`: db, auth, authz, services, server functions
  (`*/functions.ts`), jobs, worker, migrations (`drizzle/`).
- `packages/shared`: browser-safe code (inputs, DTOs, error text, `geo/`,
  Paraglide catalog).

Import across workspaces as `@trespass/server/locations/functions` (path below
`src/`, no extension; directory index needs `/index`). `~/` =
`apps/client/src/`. Below, `server/…` = `apps/server/src/…`, `shared/…` =
`packages/shared/src/…`.

## Commands

From the repo root: `bun run dev` · `check` (lint + typecheck) · `format` ·
`build` · `db:generate` · `gen` · `worker` · `create-admin-invite`.

## Conventions

- English code. Every user-facing string goes in
  `packages/shared/messages/de.json`.
- Data-touching server functions use `authMiddleware` or
  `roleMiddleware("admin")`; server routes use `withAuth`.
- Errors: throw `HttpError(409, "CODE")` or `AppError("CODE[:detail]")`; map
  codes to German in `shared/error-text.ts`. Client calls go through
  `runAction`.
- Schema: edit `server/db/schema.ts`, run `db:generate`, commit the migration.
- `bun:sqlite` is sync; `db.transaction` takes a sync callback.
- Jobs: `enqueueJob` + `addJobHandler`. Handlers must be idempotent. Web code
  imports job kinds from `<domain>/kinds.ts`, never `*/jobs.ts` (keeps worker
  deps out of the web bundle).
- **The worker has no Paraglide.** Nothing it imports may import
  `@trespass/shared/paraglide/messages`; store markers, render German in the
  web process.
- Browser-only libraries are imported dynamically behind
  `import.meta.env.SSR`.
- Never edit `routeTree.gen.ts` or `shared/paraglide/` (generated).

## Hardening

- CSP (production): no hand-written `<script>`/`<style>`, no
  `eval`/`new Function`. Inline scripts need the request nonce.
- Non-GET with a foreign `Origin` → 403. From curl send `Origin: <ORIGIN>`.
- Forms: disable submit until hydrated (`useHydrated()`,
  `~/lib/hydrated.ts`).
- Close the DB with `closeDb()`/`closeDatabase()`, never `$client.close()`.
  Long-running jobs watch their `signal`.

## UI

- Login-only pages go under `routes/_authed/`.
- Reuse `components/layout/` and `components/ui/`; tokens and type roles live
  in `styles/app.css`.
- Icons: import Tabler icons **only** in `components/ui/icons.tsx`, as plain
  named imports. Derive their types via `Parameters<typeof X>[0]`.
- JSX slot props: resolve once with `children()`. Reading twice breaks
  hydration silently.
- Admin sections: register in `lib/admin-sections.ts`, call `guardSection` in
  `beforeLoad`; server functions still use `roleMiddleware("admin")`.

## Authorization

`server/authz/` is the **only** place for permission logic.

- Filter **only in SQL** with the `visible*Where(ctx)` predicates (locations,
  visits, photos, history, comments, trips). Never filter rows in JS.
- Location coordinates come from `visibleLatExpr`/`visibleLonExpr`; every
  location response goes through `serializeLocation`.
- Invisible or missing → 404. Visible but not allowed → 403.
- Audits and job logs record ids only — never coordinates or text.
- A trip never widens location access: stops are loaded and serialized at
  the viewer's level.
- Photo originals: uploader and admins only.

## Feature invariants

- **Search** (FTS5 `locations_fts`, handle in `server/search/fts.ts`, not
  `schema.ts`): index only view-level text (name, description, tags, place,
  approved history), never notes, parking or coordinates. Every write to
  indexed fields calls `reindexLocations` in the same transaction.
- **Markdown**: render user text only through `server/markdown.ts`;
  `innerHTML` only for its output.
- **Map**: no third-party URL in the runtime style. Assets come from
  `bun run map-assets`.
- **Tiles**: `server/tiles/writer.ts` is the only writer of `TILES_PATH`
  (worker only).
- **Photos**: strip all metadata from derivatives; matching only suggests a
  location/visit, never attaches.
- **Export** (`docs/export-format.md`): for a new table or column, decide
  whether it is exported and update `server/export/build.ts` and the doc.
  Never export auth data, invites, sessions, secrets or notifications.

## Research (DESIGN §6)

- Admin only. **The inbox (`candidates`) is the only output**; no job
  changes a location.
- Page text is untrusted: the LLM has no tools and returns schema JSON; a fact
  is kept only if its quote appears verbatim.
- **Never send coordinates to the LLM or to search.**
- Crawl politely: robots.txt, per-host delay, generic UA, no private hosts.
- Dedupe (`research/store.ts`) uses exact coordinates — never reuse it outside
  admin-only code.
