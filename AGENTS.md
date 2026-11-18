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

## Locations and authorization (Stage 2)

- `src/server/authz/` is the **only** place for location permission logic:
  `levels.ts` (`locationLevel`, `LEVELS`, `ROLE_CEILING`, `canSeeExact`),
  `predicates.ts` (`locationsAtLeastWhere`, `visibleLocationsWhere`, `preciseWhere`),
  `coords.ts` (`visibleLatExpr` / `visibleLonExpr`), `load.ts` (`loadLocationForCtx`,
  `requireLocationForCtx`, `locationLevels`), `serialize.ts` (`serializeLocation`),
  `metamorphic.ts` (test helper) and `index.ts` (re-exports). `actions.ts` keeps
  app-level `can`; `ctx.ts` keeps `AuthCtx`.
- **Rules:** filter locations **only in SQL** with `visibleLocationsWhere(ctx)` —
  never in JS. Every query that filters, sorts or returns coordinates uses
  `visibleLatExpr` / `visibleLonExpr`. All responses go through
  `serializeLocation` (below `precise` exact coords, outline, parking, notes and
  fuzz radius are absent, not null). Invisible or missing → 404, never 403;
  403 only when visible but below the required level. Geocode jobs and the
  audit diff never record exact coordinates.
- `src/server/locations/` holds `service.ts` (create/get/update/move/
  setVisibility/grants/delete/listLocations/findDuplicates), `functions.ts`
  (server functions with `authMiddleware`), `errors.ts` (`LocationsError`),
  `categories.ts`. Inputs/outputs/error text live in `src/lib/locations/`.
  Geo helpers: `src/lib/geo/` (parser, leak detector, distance) and
  `src/server/geo/` (`fuzz.ts`, `tz.ts`).
- The ten categories (DESIGN §2) are seeded **idempotently at startup** in
  `nitro/startup.ts` via `seedCategories()` — admin edits survive, tests seed
  them through `authz/test-fixtures.ts`. Reverse geocoding is a separate
  job (`geocode.reverse`, injectable fetch, 1 req/s, `GEOCODE=off` disables it).

## Map and location pages (Stage 3)

- `src/routes/tiles.$.ts` serves `GET /tiles/{z}/{x}/{y}.mvt` from the read-only MBTiles file at `TILES_PATH` (default `<dir of DATABASE_PATH>/../tiles/tiles.sqlite`, optional in env.ts). `withAuth` gives 401 JSON without a session, never a redirect; missing file/table/row → 204; TMS y is `(2^z - 1) - y`; gzip blobs keep `Content-Encoding: gzip`. It does no per-location checks. A splat file route is used because a literal `.mvt` after a `$y` segment is not a valid TanStack Router param name. Reader/handler tests live in `src/server/tiles/`.
- The style is built in code (`src/lib/map/style.ts`) from `@protomaps/basemaps` (`layers("protomaps", namedFlavor("light"), { lang: "de" })`), with one self-hosted vector source, `/map/fonts/...` glyphs and `/map/sprites/v4/light`. Never put a third-party URL in the runtime style. `bun run map-assets` downloads fonts/sprites from protomaps/basemaps-assets into `public/map/` (gitignored, regenerated by the Dockerfile build and `bun run e2e`) and copies maplibre-gl's standalone worker there. Without those assets the map still shows pins, just no labels.
- `maplibre-gl` is imported dynamically in `MapView`'s `onMount`, so SSR never touches it; its CSS is imported in the same module. CSP stays strict: `worker-src 'self'` plus `maplibregl.setWorkerUrl("/map/maplibre-gl-worker.mjs")` avoids MapLibre's default blob worker; `connect-src 'self'` covers tiles/glyphs/sprites.
- `src/components/map/map-view.tsx` clusters the server-serialized pins, colours them by status (`src/lib/locations/status.ts`), shows a category icon and a popup with a link to the location page; click/long-press picks coordinates in forms; optional marker and fuzz-radius circle; the map is removed on unmount.
- `/` keeps filters (q, status, category, tag, country) in URL search params via `src/lib/locations/list-search.ts` (`parseLocationSearch` as `validateSearch`, `patchLocationSearch`, `toListInput`). The first load fits all visible locations (or Germany); a `moveend` bbox is debounced 300 ms before the `listLocationsFn` query (limit 2000). The sr-only `home_hello` heading is kept because existing e2e fixtures assert it. The "+ Ort" button uses the app-level `can` from `src/lib/app-actions.ts` (re-exported by `server/authz/actions.ts`) so the client never imports server modules.
- `/locations/new` uses `LocationForm` (TanStack Form store, live `parseCoordinates`/`formatCoordinates`, settings' default fuzz, map pick, `findDuplicatesFn` suggestions and a `findCoordinateLikeText` warning). `/locations/$locationId` renders only serialized data: exact notes/parking/coordinates/"Öffnen in …" links at `precise+`, otherwise the stable fuzzed point, a circle and "Ungefährer Standort". `/locations/$locationId/edit` shows a conflict message and reloads on `VERSION_CONFLICT`. `listPrincipalsFn` (admin/member) feeds the "Teilen" picker; writes use `runAction` plus query invalidation.

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
