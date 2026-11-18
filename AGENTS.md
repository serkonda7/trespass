# Agent briefing

Trespass: private urbex log. Read DESIGN.md first. Same stack as Hausmeister:
Bun 1.4, TanStack Start (Solid, SSR, Nitro bun preset), SQLite via `bun:sqlite` +
Drizzle, Better Auth (password + passkeys, invite-only), Tailwind 4 + Kobalte,
Paraglide (German only), Biome, `bun test`, Playwright. Dependencies are pinned
exactly: add one with `bun add --exact`, only on purpose.

Stage 1 is the **foundation only**: identity, admin and jobs. Locations, map,
journal, photos, trips, research and export come in later stages.

## Layout
- `src/routes/` file routes. Pages needing login live under `_authed/` (the
  layout redirects to `/login`). Server routes (`server.handlers`) live here too:
  `health.ts`, `api/auth/$.ts` (Better Auth), `api/v1/me.ts`.
- `src/server/` server-only code. `env.ts` (`getEnv()`, Zod-validated). `db/`
  has `schema.ts`, `client.ts` (`getDb()`), `test-db.ts`. `auth/` holds `auth.ts`
  (Better Auth config), `handler.ts` + `lockout.ts` (sign-in lockout),
  `invites.ts` (+ `invite-functions.ts`, public), `users.ts` (create/disable
  users, `loadAuthCtx`), `context.ts` (`getAuth`, `withAuth`, `HttpError`; safe
  in tests), `session.ts` (request-bound helpers), `middleware.ts`, `functions.ts`.
  `authz/ctx.ts` has `AuthCtx`/`Role`, `authz/actions.ts` the app-level `can` /
  `requireCan` (DESIGN §3.5). `http/` has the CSRF guard, CSP and rate limiter.
  `admin/` has users, groups and their admin-only server functions. `audit.ts`
  writes app-level events. `settings/` owns the instance singleton. `jobs/` is
  the queue, worker, schedule and handler registry. `shutdown.ts` is graceful
  shutdown.
- `src/nitro/startup.ts` validates env, migrates and prints the first-admin
  invite at process start. The **worker is a separate process**
  (`scripts/worker.ts`, `bun run worker`); the web process does not run jobs.
- `src/components/ui/` UI primitives; `app-shell.tsx` is the header/nav (Karte
  and Admin for now — leave a spot for Logbuch and Suche); `confirm-dialog.tsx`
  a confirm-before-acting button.
- `src/lib/` shared code (`cn`, `auth-client`, query options, labels, error
  text, German format helpers, `run-action`, hydration, Zod config, small
  pure helpers with tests). `messages/de.json` is the string catalog.
  `drizzle/` holds generated SQL migrations; commit them.
- Admin area: `src/routes/_authed/admin.tsx` is the layout with section nav;
  sections are listed in `src/lib/admin-sections.ts` (admin only currently).
  A section route calls `guardSection(context.user.role, "/admin/x")` in
  `beforeLoad`; its server functions still use `roleMiddleware("admin")`.
  Wrap server-function calls in `runAction` and throw `HttpError(409, "CODE")`;
  map codes to German in `src/lib/error-text.ts`.

## Commands
`bun run dev` · `build` · `start` · `check` (= `lint` + `typecheck` + `test`) ·
`format` (Biome, writes) · `db:generate` (after schema edits) · `gen` (route tree
+ Paraglide; `typecheck` and `test` run it first) · `worker` (standalone job
worker) · `e2e` (Playwright, not part of `check`) · `create-admin-invite`.

## Conventions
- English code, identifiers and comments. Every user-facing string goes in
  `messages/de.json`, never inline.
- Every data-touching server function uses `authMiddleware` (or
  `roleMiddleware("admin")`). Server routes use `withAuth`.
- Schema: edit `src/server/db/schema.ts`, run `bun run db:generate`, commit
  `drizzle/*`. The init migration also inserts the settings singleton (id 1).
  Ids come from `$defaultFn(Bun.randomUUIDv7)`, timestamps are `timestamp_ms`.
- Users are created only through invites (`acceptInvite` in `auth/invites.ts`)
  or, in tests, `createUserWithPassword(db, {...})`. Public sign-up is off.
  Admin changes go through `server/admin/users.ts` (guards: last active admin,
  self-disable).
- `bun:sqlite` is synchronous: `.all()/.get()/.run()`, and
  `db.transaction((tx) => …)` takes a sync callback.
- Tests are `*.test.ts` next to the code. Use `createTestDb()`, never `getDb()`.
  Import from `auth/context`, not `auth/session`, in tests. `createTestAuth()`
  and `signInRequest()` in `auth/test-helpers.ts` drive real sign-ins.
- Jobs: `enqueueJob(db, kind, payload, { runAt? })` in `server/jobs/queue.ts`.
  Add handlers with `addJobHandler(registry, kind, fn, opts)` in
  `server/jobs/handlers.ts`. They must be idempotent (a crash re-runs them).

## Hardening & gotchas
- CSP (production only): every inline script needs the request nonce. Zod and
  `zod-config.ts` share one client chunk (`vite.config.ts`), so jitless is set
  before any schema is created. Router scripts get it via `ssr.nonce`
  (`lib/csp-nonce.ts`). Never add `<script>`/`<style>` by hand, never
  `eval`/`new Function`. `style` attributes are allowed. Every e2e test fails
  on a CSP violation.
- Slow links: use `useHydrated()` / `adoptTypedValue()` from `lib/hydrated.ts`
  for forms (submit disabled with "Lädt …" until hydrated).
- Shutdown: `server/shutdown.ts` (wired in the startup plugin). Close the DB
  with `closeDb()`/`closeDatabase()`, never `$client.close()` alone. Long-running
  work must watch the job `signal`.
- Non-GET requests with a foreign `Origin` get 403. Send `Origin: <ORIGIN>`
  from curl when testing.
- Don't edit `src/routeTree.gen.ts` or `src/paraglide/` — both are generated
  and gitignored. Links to routes that don't exist yet fail typecheck; cast
  them (`to={"/x" as "/"}`) until the route exists.

## E2E tests (Playwright)
`bun run e2e` builds into `node_modules/.cache/trespass-e2e/` (never `.output`),
starts it on port 3212 against a throwaway DB (`e2e/server.ts`), accepts the
startup bootstrap invite (`e2e/bootstrap.setup.ts`), then runs `e2e/*.e2e.ts`
on a Pixel 7 viewport. `E2E_SKIP_BUILD=1 bunx playwright test` reuses the last
build. Import `test`/`expect` from `e2e/fixtures.ts`:
`adminPage` (signed-in first admin), `page` (signed out),
`newUser(role)` (creates a user via a real invite, signed in in its own context),
`cliInvite(role)`, `acceptInvite`, `signIn`, `submitLogin`, `userMenu`,
`uniqueName`, `hydrated`. Each test gets its own `X-Forwarded-For`.
