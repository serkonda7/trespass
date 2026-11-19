# Agent briefing

Trespass: private urbex log. Read DESIGN.md first. Same stack as Hausmeister:
Bun 1.4, TanStack Start (Solid, SSR, Nitro bun preset), SQLite via `bun:sqlite` +
Drizzle, Better Auth (password + passkeys, invite-only), Tailwind 4 + Kobalte,
Paraglide (German only), Biome, `bun test`, Playwright. Dependencies are pinned
exactly: add one with `bun add --exact`, only on purpose.

The MVP (DESIGN §12) is in place: identity, admin and jobs, locations with
coordinate privacy, map and tile regions, visits/journal, photos, search and
export. v1.1 is in place too: history + sources (archive.org), comments,
equipment and packing templates, trips with a route preview. v1.3 (research)
is in place as well; v1.2 (push, check-in, offline) is not yet, so `watch`
creates inbox entries without a Web Push.

## Workspaces
Bun workspaces driven by Turborepo (`turbo.json`). One hoisted `node_modules`
at the root (`bunfig.toml`), so the client build and the server workspace
resolve the same Solid/TanStack copies. Dependency direction is strictly
`client → server → shared` (client also imports shared); never import back up.

- `apps/client` (`@trespass/client`) — the TanStack Start app: routes,
  components, client-only `lib/`, styles, `public/`, `vite.config.ts`, the
  Nitro startup plugin and the e2e suite. Its build bundles the server
  workspace into `apps/client/.output` (the web process).
- `apps/server` (`@trespass/server`) — server-only code: db, auth, authz,
  services, **server functions** (`*/functions.ts`, compiled into RPC stubs by
  the client's Vite build), jobs, the worker (`scripts/worker.ts`) and the
  migrations in `apps/server/drizzle/`.
- `packages/shared` (`@trespass/shared`) — code both sides need and that is
  safe in the browser: Zod inputs, DTO types, error codes/text, `authz/ctx.ts`
  (`AuthCtx`/`Role`), `app-actions.ts`, `geo/`, `format.ts`, `normalize.ts`,
  `diff.ts`, `mime-sniff.ts`, `csp-nonce.ts`, and the Paraglide catalog
  (`messages/de.json`, `project.inlang`, generated `src/paraglide/`).

Imports across workspaces use the package name plus the path below `src/`
without extension: `@trespass/server/locations/functions`,
`@trespass/shared/locations/inputs`, `@trespass/shared/paraglide/messages`
(directory indexes need `/index`, e.g. `@trespass/server/db/index`). Inside the
client, `~/` is `apps/client/src/`; server and shared use relative imports.
Below, `server/…` means `apps/server/src/…` and `shared/…` means
`packages/shared/src/…`. Dev data (`data/`) and the default `DATABASE_PATH` /
`UPLOAD_DIR` live at the repo root (`workspaceRoot()` in `server/paths.ts`),
whichever workspace a command runs in.

## Layout
- `apps/client/src/routes/` file routes. Pages needing login live under `_authed/` (the
  layout redirects to `/login`). Server routes (`server.handlers`) live here too:
  `health.ts`, `api/auth/$.ts` (Better Auth), `api/v1/me.ts`.
- `apps/server/src/` server-only code. `env.ts` (`getEnv()`, Zod-validated). `db/`
  has `schema.ts`, `client.ts` (`getDb()`), `test-db.ts`. `auth/` holds `auth.ts`
  (Better Auth config), `handler.ts` + `lockout.ts` (sign-in lockout),
  `invites.ts` (+ `invite-functions.ts`, public), `users.ts` (create/disable
  users, `loadAuthCtx`), `context.ts` (`getAuth`, `withAuth`, `HttpError`; safe
  in tests), `session.ts` (request-bound helpers), `middleware.ts`, `functions.ts`.
  `shared/authz/ctx.ts` has `AuthCtx`/`Role`, `authz/actions.ts` the app-level `can` /
  `requireCan` (DESIGN §3.5). `http/` has the CSRF guard, CSP and rate limiter.
  `admin/` has users, groups and their admin-only server functions. `audit.ts`
  writes app-level events. `settings/` owns the instance singleton. `jobs/` is
  the queue, worker, schedule and handler registry. `shutdown.ts` is graceful
  shutdown.
- `apps/client/src/nitro/startup.ts` validates env, migrates and prints the first-admin
  invite at process start. The **worker is a separate process**
  (`apps/server/scripts/worker.ts`, `bun run worker`); the web process does not run jobs.
- `apps/client/src/components/ui/` UI primitives; `app-shell.tsx` is the header/nav (Karte
  and Admin for now — leave a spot for Logbuch and Suche); `confirm-dialog.tsx`
  a confirm-before-acting button.
- `apps/client/src/lib/` client code (`cn`, `auth-client`, query options, labels,
  `run-action`, hydration, Zod config, map style, small helpers with tests);
  pure code the server also needs goes to `packages/shared/src/`.
  `packages/shared/messages/de.json` is the string catalog.
  `apps/server/drizzle/` holds generated SQL migrations; commit them.
- Admin area: `apps/client/src/routes/_authed/admin.tsx` is the layout with section nav;
  sections are listed in `apps/client/src/lib/admin-sections.ts` (admin only currently).
  A section route calls `guardSection(context.user.role, "/admin/x")` in
  `beforeLoad`; its server functions still use `roleMiddleware("admin")`.
  Wrap server-function calls in `runAction` and throw `HttpError(409, "CODE")`;
  map codes to German in `packages/shared/src/error-text.ts`.

## Locations and authorization (Stage 2)

- `apps/server/src/authz/` is the **only** place for location permission logic:
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
- `apps/server/src/locations/` holds `service.ts` (create/get/update/move/
  setVisibility/grants/delete/listLocations/findDuplicates), `functions.ts`
  (server functions with `authMiddleware`), `errors.ts` (`LocationsError`),
  `categories.ts`. Inputs/outputs/error text live in `shared/locations/`, query options and URL search helpers in `apps/client/src/lib/locations/`.
  Geo helpers: `shared/geo/` (parser, leak detector, distance) and
  `apps/server/src/geo/` (`fuzz.ts`, `tz.ts`).
- The ten categories (DESIGN §2) are seeded **idempotently at startup** in
  `apps/client/src/nitro/startup.ts` via `seedCategories()` — admin edits survive, tests seed
  them through `authz/test-fixtures.ts`. Reverse geocoding is a separate
  job (`geocode.reverse`, injectable fetch, 1 req/s, `GEOCODE=off` disables it).

## Map and location pages (Stage 3)

- `apps/client/src/routes/tiles.$.ts` serves `GET /tiles/{z}/{x}/{y}.mvt` from the read-only MBTiles file at `TILES_PATH` (default `<dir of DATABASE_PATH>/../tiles/tiles.sqlite`, optional in env.ts). `withAuth` gives 401 JSON without a session, never a redirect; missing file/table/row → 204; TMS y is `(2^z - 1) - y`; gzip blobs keep `Content-Encoding: gzip`. It does no per-location checks. A splat file route is used because a literal `.mvt` after a `$y` segment is not a valid TanStack Router param name. Reader/handler tests live in `apps/server/src/tiles/`.
- The style is built in code (`apps/client/src/lib/map/style.ts`) from `@protomaps/basemaps` (`layers("protomaps", namedFlavor("light"), { lang: "de" })`), with one self-hosted vector source, `/map/fonts/...` glyphs and `/map/sprites/v4/light`. Never put a third-party URL in the runtime style. `bun run map-assets` downloads fonts/sprites from protomaps/basemaps-assets into `public/map/` (gitignored, regenerated by the Dockerfile build and `bun run e2e`) and copies maplibre-gl's standalone worker there. Without those assets the map still shows pins, just no labels.
- `maplibre-gl` is imported dynamically in `MapView`'s `onMount`, so SSR never touches it; its CSS is imported in the same module. CSP stays strict: `worker-src 'self'` plus `maplibregl.setWorkerUrl("/map/maplibre-gl-worker.mjs")` avoids MapLibre's default blob worker; `connect-src 'self'` covers tiles/glyphs/sprites.
- `apps/client/src/components/map/map-view.tsx` clusters the server-serialized pins, colours them by status (`apps/client/src/lib/locations/status.ts`), shows a category icon and a popup with a link to the location page; click/long-press picks coordinates in forms; optional marker and fuzz-radius circle; the map is removed on unmount.
- `/` keeps filters (q, status, category, tag, country) in URL search params via `apps/client/src/lib/locations/list-search.ts` (`parseLocationSearch` as `validateSearch`, `patchLocationSearch`, `toListInput`). The first load fits all visible locations (or Germany); a `moveend` bbox is debounced 300 ms before the `listLocationsFn` query (limit 2000). The sr-only `home_hello` heading is kept because existing e2e fixtures assert it. The "+ Ort" button uses the app-level `can` from `shared/app-actions.ts` (re-exported by `server/authz/actions.ts`) so the client never imports server modules.
- `/locations/new` uses `LocationForm` (TanStack Form store, live `parseCoordinates`/`formatCoordinates`, settings' default fuzz, map pick, `findDuplicatesFn` suggestions and a `findCoordinateLikeText` warning). `/locations/$locationId` renders only serialized data: exact notes/parking/coordinates/"Öffnen in …" links at `precise+`, otherwise the stable fuzzed point, a circle and "Ungefährer Standort". `/locations/$locationId/edit` shows a conflict message and reloads on `VERSION_CONFLICT`. `listPrincipalsFn` (admin/member) feeds the "Teilen" picker; writes use `runAction` plus query invalidation.

## Visits and journal (Stage 4)

- `apps/server/src/authz/visits.ts` holds every visit rule and the SQL predicate
  `visibleVisitsWhere(ctx)`: a visit is visible when its location is visible
  (via an `EXISTS` over `locations`) **or** the caller is its author. Authors keep
  their visit after the location becomes invisible; the DTO then has
  `location: null`. Never filter visits in JS. Create needs `contribute` on the
  location and a writable role; edit needs the author or `edit`, delete the author
  or `manage`. Invisible → `VISIT_NOT_FOUND` (404), visible-but-denied → 403.
- `apps/server/src/visits/` has `service.ts` (create/update/delete/get/listFeed/
  listVisitsForLocation/yearReview/getLocationTimeline), `functions.ts` (server
  functions with `authMiddleware`) and `errors.ts`. Zod inputs, output types and
  error text live in `shared/visits/`, query options in `apps/client/src/lib/visits/`. `visitedOn` is the
  local date in the location's tz (`todayInTz` in `shared/format.ts`); audits record
  only ids, never journal text or coordinates. Optimistic locking throws
  `VERSION_CONFLICT` (409).
- `apps/server/src/locations/status.ts` has `effectiveStatusExpr()`; it is used in
  `getLocation`, `listLocations` output **and** its status filter. `visited` is
  derived from visits, but a later terminal status wins; `storedStatus` is kept
  for the edit form. Status changes set `locations.status_changed_at` and record
  a `location.status_changed` event with a status-only diff (timeline source).
- Markdown goes through `renderMarkdown(md, { resolvePhoto })` /
  `renderJournalMarkdown` in `apps/server/src/markdown.ts` (`marked` + `sanitize-html`).
  Only the sanitized `journalHtml` is sent to everyone; `journalMd` is included
  only for editors. `photo:ID` embeds are resolved by the hook (always null until
  Stage 5). `previewMarkdownFn` renders editor previews. `innerHTML` is used only
  for this server-sanitized HTML.
- `/logbuch` is the feed (cursor paging, "Mehr laden") plus the year review;
  the location page has a "Besuche" tab with visits and status changes. The map
  status filter includes "Besucht". The coordinate warning uses the client-side
  `findCoordinateLikeText` when the location is visible to friends.

## Photos (Stage 5)

- `apps/server/src/authz/photos.ts` holds **all** photo rules: `visiblePhotosWhere(ctx)` (location or
  visit visible, uploader or admin; unsorted only uploader/admin), `photosAtLeastWhere`, the
  DTO-redaction helpers and the uploader/attach/edit/delete/cover decisions. Filter photos only
  in SQL. Invisible/missing → `PHOTO_NOT_FOUND` (404), visible-but-denied → 403.
- Exact GPS, the GPS-derived suggestion and the original URL are present only for the uploader,
  admins and callers with `precise` on the photo's location (§3.4 rules 4 & 6); below that the
  keys are absent. Derivatives are served to everyone who sees the photo. While `processing`,
  `/files/:id?size=<derivative>` answers **202 + `Retry-After: 1`** (the UI polls); a failed one
  answers 404. Originals answer 404 for non-uploaders/non-admins.
- Originals are stored content-addressed at `UPLOAD_DIR/ab/cd/<sha256>`; metadata-free WebP
  derivatives (400/1600/2560) at `UPLOAD_DIR/derived/<sha256>/<size>.webp`. `apps/server/src/photos/`
  has `storage.ts`, `process.ts` (EXIF via `exifr` before sharp, `heicSupported()`, all metadata
  stripped, no `withMetadata()`), `upload.ts`, `serve.ts`, `match.ts`, `jobs.ts`, `gc.ts`,
  `service.ts` and `functions.ts`. Shared inputs/DTOs/errors live in `shared/photos/`, queries in `apps/client/src/lib/photos/`.
- `POST /api/v1/photos` streams one multipart `file` (max 100 MB) to a temp file, hashes it,
  dedupes into the blob store, inserts a `processing` row and enqueues `photos.process` in the
  separate worker. `photos.process` extracts EXIF, builds derivatives, sets `taken_at` (naive
  camera clock interpreted in the matched location's tz), then **suggests** a location (nearest
  within 300 m using the uploader's visible coordinates) and a visit (same local day) without
  attaching them. No GPS → unsorted. `photos.gc` only removes blobs/derivatives whose hash has
  no remaining row; a nightly `photos.sweep` finds cascaded orphans.
- Journal `![alt](photo:ID)` embeds are resolved in one SQL batch with the photo predicate
  (`resolvePhotoEmbeds`); invisible or unprocessed embed ids are dropped. UI: `apps/client/src/components/photos/`
  (uploader with progress, gallery with cover/caption/delete, visit thumbs/embed picker,
  unsorted list), the location page's Fotos tab and cover header, `/fotos/unsortiert`, and the
  Logbuch link to it. `locations.cover_photo_id` has no DB FK (circular Drizzle types); the
  service validates it and clears it on photo delete.

## Search (Stage 6)

- `apps/server/drizzle/0004_search_fts.sql` creates the FTS5 table `locations_fts` (`location_id UNINDEXED, name, description, history, tags, place`, `tokenize='trigram remove_diacritics 1'`). The Drizzle handle lives in `apps/server/src/search/fts.ts` — never in `db/schema.ts`, so drizzle-kit cannot manage the virtual table. `history` stays empty until history entries exist.
- **Only view-level text is indexed** (§3.4): name, description, tag names, place (country + admin_area). Never index access/danger notes, parking, coordinates, fuzz radius or photo/visit data, or search becomes a precise-data oracle. Index text and query use `normalizeSearchText`.
- `apps/server/src/search/indexer.ts`: `reindexLocations(tx, ids)` runs inside the same transaction as every write to indexed fields — `createLocation`, `updateLocation` (tag edits included), `deleteLocation` and the `geocode.reverse` handler. `ensureSearchIndex(db)` backfills/repairs idempotently at startup and once per DB before the first search.
- `apps/server/src/search/query.ts`: `searchLocations(db, ctx, input)` uses FTS MATCH for words ≥ 3 chars (every word a quoted phrase, so FTS operators are plain text) and `name_sort LIKE` for 1–2 chars, always ANDs `visibleLocationsWhere(ctx)` in SQL, and returns `visibleLatExpr/visibleLonExpr` coordinates through the same row mapper as `listLocations`. `listLocations` simply delegates here, so the map box and `/suche` share one path.
- `/suche` (debounced `q` in the URL) lists name, category, status, country and an "ungefähr" badge; `searchProbes` in `authz/metamorphic.ts` checks that search responses stay byte-identical when only exact coordinates change.

## Tile regions (Stage 7)

- `apps/server/src/tiles/regions.ts` holds the pure rules: a point needs a new region unless it is inside a non-failed region with ≥ 5 km margin; new boxes are ≥ 20 × 20 km with the point at a random offset; boxes within 10 km merge into one. Longitudes may wrap over ±180 (the extractor splits them); latitudes clamp to ±85. Crypto RNG by default, injectable for tests; fast-check tests cover margin, size and offset variance.
- `apps/server/src/tiles/writer.ts` is the **only** read-write handle to TILES_PATH (worker only): WAL, MBTiles schema, XYZ→TMS flip, batched upserts, metadata. The app's read-only `store.ts` sees new tiles without a restart. `pmtiles-extractor.ts` probes the newest Protomaps daily build (HEAD up to 10 days, `TILES_BUILD_URL` overrides), runs the go-pmtiles CLI (`PMTILES_BIN`) and walks the local archive with the `pmtiles` package's byte-range `Source`; tile bytes are unchanged.
- Jobs in `apps/server/src/tiles/jobs.ts`: `tiles.ensure` (enqueued by location create/move inside their transaction, exact point loaded server-side, never logged), `tiles.extract` (budget check, z7–15 / world z0–6, status/bytes/build_date, deletes merged rows), `tiles.world`, daily `tiles.prune` (empty_since, 30-day deletion, exclusive tile removal), daily `tiles.refresh` (one stale region per run), `tiles.delete`. `TILES=off` disables everything; logs mention region ids only. Admin `/admin/tiles` only enqueues jobs and shows rounded boxes, sizes and status — no location ids.
- `tiles.sqlite` is **not backed up** (§8.5); it can be regenerated by re-extracting all regions. The runtime image pins go-pmtiles v1.31.2 with a verified sha256.

## Export (Stage 8)

- `GET /api/v1/export` streams a ZIP while the client reads it; the layout is the contract in `docs/export-format.md` (`EXPORT_FORMAT_VERSION = 1` in `shared/export/types.ts`). Code in `apps/server/src/export/`: `build.ts` (`writeExport`, `PATHS`), `zip.ts` (streaming ZIP64 writer), `stream.ts` (backpressure, `ExportAborted`), `snapshot.ts` (read-only connection in one read transaction), `registry.ts` (one export per user, two overall, page tickets), `handler.ts` (route logic + `export.created` audit of counts only), `functions.ts`, `service.ts`, `paths.ts`.
- Contents follow `visibleLocationsWhere` / `visibleVisitsWhere` / `visiblePhotosWhere` (never JS filtering); locations use `visibleLatExpr`/`visibleLonExpr` in SQL and `serializeLocation`. New tables/columns: decide whether they are exported, then update `build.ts`, the doc and the secret-sentinel test. Never export auth tables, invites, sessions, passkeys, settings secrets or notifications; `data/users.json` holds only referenced ids and display names.
- Page: `/admin/export` is a section for admin **and** member; it reserves a slot with `reserveExportFn`, then opens `?ticket=…`; `getExportInfoFn` gives the estimate and progress. Guests get 404. Tests: `exportToMemory()` in `apps/server/src/export/test-helpers.ts`; metamorphic check pins `now` so the whole archive is byte-comparable.

## History, comments, equipment and trips (v1.1)

- Generic domain errors for these services: `server/errors.ts` (`AppError`,
  `parseAppInput`; message "CODE" or "CODE:detail", German text in
  `shared/error-text.ts`, which ignores the detail).
- **History** (`server/history/`, rules in `server/authz/history.ts`):
  `visibleHistoryWhere(ctx)` — approved entries at `view`, drafts only at
  `edit`; writes need `edit`. Dates are ISO prefixes per precision ('YYYY-MM-DD',
  'YYYY-MM', 'YYYY'; decades normalized), so they sort as text. Sources belong
  to exactly one entry (`sources.history_id`, no join table) and inherit its
  visibility. Approved text feeds the FTS `history` column: every history write
  calls `reindexLocations` in its transaction (`history/texts.ts` avoids an
  import cycle). Approved entries also appear in `getLocationTimeline`.
- **archive.org**: new or changed source URLs enqueue `sources.archive`
  (`history/archive.ts`, injectable fetch, generic UA, only the URL is sent).
  The last failed attempt marks the source `failed`; `ARCHIVE=off` (e2e) marks
  new sources `skipped` and enqueues nothing.
- **Comments** (`server/comments/`, rules in `server/authz/comments.ts`): one of
  `location_id` / `visit_id` / `photo_id` is set (CHECK + cascading FKs);
  `visibleCommentsWhere(ctx)` follows the target's own predicate. Guests read
  only; authors edit; authors and admins delete (soft: body wiped, row kept for
  replies). Bodies go through `renderMarkdown` without photo embeds. UI:
  `components/comments/comment-thread.tsx` (location tab, visit cards, photo
  viewer).
- **Equipment** (`server/equipment/`): private to the owner, scoped by
  `owner_id` in SQL; foreign ids are 404. `createDefaultTemplates` adds the four
  DESIGN §5.5 templates once. Page `/ausruestung` (user menu).
- **Trips** (`server/trips/`, rules in `server/authz/trips.ts`):
  `visibleTripsWhere(ctx)` = owner, listed app users, admins. Seeing a trip
  never widens location access: stops are loaded with `visibleLocationsWhere`
  and serialized with `serializeLocation` at the viewer's level; invisible
  stops are absent (editors get a `hiddenStops` count and keep those stops on
  reorder). Owner/admin edit; non-guest people tick the packing list. Visits
  may carry a `tripId` (checked against `visibleTripsWhere`; cleared on trip
  delete). `tripProbes` in `authz/metamorphic.ts` covers trips, history and
  comments. Route preview: `shared/trips/route.ts` (straight lines from the
  serialized points; legs touching a fuzzed point are "≈"). Pages: `/touren`,
  `/touren/new?location=`, `/touren/$tripId`, `/touren/$tripId/edit`; "Zur
  Tour hinzufügen" on the location page. The emergency contact is stored and
  shown; alerts come with the v1.2 check-in.

## Research (v1.3, DESIGN §6)

- Admin only (`can(ctx, "research")`, server functions with
  `roleMiddleware("admin")`, `/recherche` 404s for everyone else, entry in the
  user menu). **The inbox (`candidates`) is the only output**: no job changes a
  location. `server/research/inbox.ts` applies decisions — accept
  (`researched` location via `createLocation`, which queues the tile region),
  later (`idea`), merge (facts → approved history on the target), reject
  (kept, never suggested again); facts become approved history with their
  evidence as sources (`history.candidate_id`, no FK: adding one would rebuild
  `history` and cascade-delete `sources`); status changes go through
  `updateLocation`. Audits carry ids and the decision only.
- Code in `apps/server/src/research/`: `areas.ts` (search areas: drawn
  polygon or circle around a pin, ≤ 5000 km², simple ring), `jobs.ts` (job
  handlers + `executeRun`), `overpass.ts`, `wikidata.ts`, `websearch.ts`
  (Wikipedia first, then SearXNG), `http.ts` (polite fetcher), `robots.ts`,
  `text.ts` (Readability + linkedom), `extract.ts` (prompts, schema, server
  checks), `llm.ts` (Claude via `@anthropic-ai/sdk`, structured output, no
  tools, metered), `budget.ts`, `store.ts` (dedupe), `runs.ts`, `categories.ts`.
  Shared: `shared/research/` (inputs, types, `quote.ts`, `languages.ts`,
  `text.ts`), `shared/geo/polygon.ts`.
- Jobs (worker only): `scan.overpass`, `scan.wikidata`, `research.enrich`
  (payload `{runId}`; a `research_runs` row is created when requested) and
  `research.watch` (weekly, Monday 04:00 Berlin, 5 locations per job, at most
  15 per week, continues by re-enqueueing itself). `maxAttempts: 2`: failures
  are recorded on the run (`failed`/`budget`/`skipped`) instead of retried.
  `RESEARCH=off` (e2e) finishes runs as `skipped` without any request.
- **Untrusted text**: the LLM gets page text fenced in `<document>`, has no
  tools and returns schema JSON; `verifyExtraction` keeps a fact only if its
  quote is found verbatim (`quoteAppearsIn`, normalized) and its date fits
  the precision. Never send coordinates to the LLM or to search; scans send
  only the area polygon (Overpass) or its bbox (Wikidata).
- **Polite crawling**: robots.txt (5xx = disallow), ≥ 5 s per host, generic
  UA, `http_cache` + bodies under `CACHE_DIR` (default `data/cache/http`, not
  backed up), ETag/Last-Modified revalidation, blocklist
  (`DEFAULT_BLOCKLIST` + `RESEARCH_BLOCKLIST`), no private/tailnet hosts, text
  types only, Wayback fallback for failed pages. Every dependency (fetch,
  LLM, sleep, cache dir) is injectable; tests never touch the network.
- **Budget**: `settings.research_budget_cents` per Berlin month over
  `research_runs.cost_cents`; 0 = no LLM use. `meteredLlm` checks before and
  books after each call.
- **Dedupe** (`store.ts`): same source key, ≤ 200 m from any candidate or
  known location, or a similar name within 5 km → evidence is attached
  instead of a new row. It compares exact stored coordinates; that is fine
  only because research is admin-only — never reuse it for other roles.
- **The worker has no Paraglide**: it is run by Bun directly, outside Vite,
  so nothing it imports may import `@trespass/shared/paraglide/messages`
  (the import fails at startup). Store markers (`FactPayload.template`,
  `name: null` for unnamed OSM features) and render German text in the web
  process or UI (`shared/research/text.ts`). The research e2e test waits for
  the worker to finish a run, which catches this.
- Not exported (working data; see `docs/export-format.md`).

## Commands
Run from the repo root; turbo fans out to the workspaces and caches results
(`.turbo/`, gitignored). `bun run dev` (client Vite dev server plus the
Paraglide compiler in watch mode) · `build` ·
`start` · `check` (= `lint` + `typecheck` + `test`) · `format` (Biome, writes,
one root config) · `db:generate` (after schema edits) · `gen` (Paraglide in
shared — the only compile path, Vite has no Paraglide plugin — and the route
tree in client; `typecheck`, `test` and `build` run it first) · `worker`
(standalone job worker) · `e2e` (Playwright, not part of `check`) ·
`create-admin-invite`. A single workspace: `bunx turbo run test --filter=@trespass/server`,
or `bun test` inside it. Each workspace's `package.json` lists only what it
imports; add a dependency with `bun add --exact <pkg> --cwd <workspace>`.

## Conventions
- English code, identifiers and comments. Every user-facing string goes in
  `packages/shared/messages/de.json`, never inline.
- Every data-touching server function uses `authMiddleware` (or
  `roleMiddleware("admin")`). Server routes use `withAuth`.
- Schema: edit `apps/server/src/db/schema.ts`, run `bun run db:generate`, commit
  `apps/server/drizzle/*`. The init migration also inserts the settings singleton (id 1).
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
  Job-kind constants live in a side-effect-free `kinds.ts` per domain
  (`photos/`, `tiles/`, `research/`); web-side code imports them from there,
  never from `*/jobs.ts`, so handlers and their deps (crawler, LLM SDK, tile
  writer, pmtiles) stay out of the web bundle.
- Bundle size: browser-only libraries (maplibre-gl, `@protomaps/basemaps`) are
  imported dynamically behind `import.meta.env.SSR` so the server build drops
  them. Nitro does not copy sharp into `.output` (`traceDeps: ["!sharp"]` +
  `rolldownConfig.external` in `vite.config.ts`); it resolves from the hoisted
  root `node_modules`, which the runtime image installs with `--production`.

## Hardening & gotchas
- CSP (production only): every inline script needs the request nonce. Zod and
  `zod-config.ts` share one client chunk (`apps/client/vite.config.ts`), so jitless is set
  before any schema is created. Router scripts get it via `ssr.nonce`
  (`shared/csp-nonce.ts`). Never add `<script>`/`<style>` by hand, never
  `eval`/`new Function`. `style` attributes are allowed. Every e2e test fails
  on a CSP violation.
- Slow links: use `useHydrated()` / `adoptTypedValue()` from `apps/client/src/lib/hydrated.ts`
  for forms (submit disabled with "Lädt …" until hydrated).
- Shutdown: `server/shutdown.ts` (wired in the startup plugin). Close the DB
  with `closeDb()`/`closeDatabase()`, never `$client.close()` alone. Long-running
  work must watch the job `signal`.
- Non-GET requests with a foreign `Origin` get 403. Send `Origin: <ORIGIN>`
  from curl when testing.
- Don't edit `apps/client/src/routeTree.gen.ts` or `packages/shared/src/paraglide/` — both are generated
  and gitignored. Links to routes that don't exist yet fail typecheck; cast
  them (`to={"/x" as "/"}`) until the route exists.

## E2E tests (Playwright)
`bun run e2e` builds into `apps/client/node_modules/.cache/trespass-e2e/` (never `.output`),
starts it on port 3212 against a throwaway DB (`apps/client/e2e/server.ts`), accepts the
startup bootstrap invite (`apps/client/e2e/bootstrap.setup.ts`), then runs `apps/client/e2e/*.e2e.ts`
on a Pixel 7 viewport. `E2E_SKIP_BUILD=1 bunx playwright test` (in `apps/client`) reuses the last
build. Import `test`/`expect` from `apps/client/e2e/fixtures.ts`:
`adminPage` (signed-in first admin), `page` (signed out),
`newUser(role)` (creates a user via a real invite, signed in in its own context),
`cliInvite(role)`, `acceptInvite`, `signIn`, `submitLogin`, `userMenu`,
`uniqueName`, `hydrated`. Each test gets its own `X-Forwarded-For`.
