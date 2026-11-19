# Export archive format (version 1)

`GET /api/v1/export` returns one ZIP (`trespass-export_YYYY-MM-DD_HH-MM.zip`,
UTC time). This is the contract for anything that reads it back. Writer:
`src/server/export/build.ts` (`PATHS` lists the files). When a file or field
changes meaning, bump `EXPORT_FORMAT_VERSION` in `src/lib/export/types.ts`.

## Container

- Standard ZIP with ZIP64 records when an entry, an offset or the entry count
  needs them (archives over 4 GiB). Entries use data descriptors (bit 3) and
  UTF-8 names (bit 11). JSON and Markdown are deflated; photos are stored as
  they are (already compressed).
- The export is produced behind a backpressured `ReadableStream`, from one
  read-only database snapshot. Entry order is not part of the format.
- Passing `now` to `writeExport` pins the ZIP timestamps and `exportedAt`, so
  an unchanged database produces a byte-identical archive (§3.4 rule 5).

## Layout

```
locations.geojson          FeatureCollection: one point per visible location
manifest.json              format version, time, exporter, scope, counts, files
data/locations.json        serialized locations (with `point`)
data/categories.json       seeded categories
data/tags.json             tags
data/visits.json           visit DTOs (people, conditions, sanitized HTML)
data/photos.json           photo DTOs (no GPS below precise)
data/grants.json           grants of managed locations
data/users.json            { id, displayName } of referenced users only
data/history.json          history entries with their sources
data/comments.json         comments on visible locations, visits and photos
data/trips.json            visible trips (stops at the exporter's level)
data/equipment.json        equipment (own; admin: everyone's)
data/pack-templates.json   packing templates (own; admin: everyone's)
journals/<date>-<slug>-<visit-id>.md   one Markdown file per visit
photos/<photo-id>.<ext>    original (admin / own) or 2560 px WebP derivative
```

`manifest.json`:

```json
{
  "format": "trespass-export",
  "formatVersion": 1,
  "appVersion": "0.0.1",
  "exportedAt": "2026-11-16T13:03:00.000Z",
  "exportedBy": { "id": "…", "role": "admin" },
  "scope": "all | own_and_visible",
  "snapshot": true,
  "counts": {
    "locations": 0, "categories": 0, "tags": 0, "visits": 0, "journals": 0,
    "photos": 0, "photoFiles": 0, "skippedPhotos": 0, "grants": 0, "users": 0,
    "history": 0, "comments": 0, "trips": 0, "equipment": 0, "packTemplates": 0
  },
  "files": {
    "geojson": "locations.geojson", "manifest": "manifest.json",
    "locations": "data/locations.json", "categories": "data/categories.json",
    "tags": "data/tags.json", "visits": "data/visits.json",
    "photos": "data/photos.json", "grants": "data/grants.json",
    "users": "data/users.json", "history": "data/history.json",
    "comments": "data/comments.json", "trips": "data/trips.json",
    "equipment": "data/equipment.json", "packTemplates": "data/pack-templates.json"
  },
  "skippedPhotos": [{ "id": "…", "reason": "processing | failed | missing" }]
}
```

Read file locations from `files` rather than hard-coding them. `snapshot: true`
means every JSON file was read from one database snapshot.

## JSON files

Every `data/*.json` except the manifest is an array with one record per line.
Ids are the database ids (UUIDv7 strings). Timestamps are ISO 8601 UTC strings;
visit dates are `YYYY-MM-DD` in the location's time zone.

- **locations**: exactly the output of `serializeLocation` — coordinates only
  in `point` (the SQL-visible point), precise-only fields absent below
  `precise`. `level`, `permissions` and the effective `status` are included.
- **categories / tags**: the seeded, editable reference tables.
- **visits**: the DTOs of `src/server/visits/service.ts`, including `people`
  and `conditions`. `journalMd` is present only where the exporter may edit
  the visit; everyone else gets the sanitized `journalHtml`.
- **photos**: the DTOs of `src/server/photos/service.ts`. `gps`,
  `suggestion` and `originalUrl` are absent unless the caller is allowed to
  see them (§3.4 rules 4 & 6).
- **grants**: `locationId`, `principalKind`, `principalId`, `level` — only for
  locations the exporter manages.
- **users**: `{ id, displayName }` of the users referenced by the other files
  (owners, authors, people, uploaders, grantees, commenters, trip people and
  contacts, exporter). No e-mail, role or auth fields.
- **history**: the DTOs of `src/server/history/service.ts` with their
  `sources` (URL, title, retrieval day, excerpt, Wayback copy). Approved
  entries of visible locations; drafts only where the exporter has `edit`.
- **comments**: the DTOs of `src/server/comments/service.ts` (`targetKind`,
  `targetId`, `parentId`, sanitized `bodyHtml`; `bodyMd` only for the
  author). Deleted comments keep their row with an empty body.
- **trips**: the DTOs of `src/server/trips/service.ts` for trips the exporter
  owns or is listed on (admin: all). `stops` holds only locations visible to
  the exporter, each serialized with `serializeLocation` at the exporter's
  level. `emergencyContact`, `people`, the packing list (`checklist`) and the
  report are included; `reportMd` only for editors.
- **equipment / pack-templates**: personal gear and templates
  (`equipmentIds`). Members export their own, admins everyone's (`ownerId`).

`locations.geojson` has one `Point` Feature per location. Its geometry comes
from `visibleLatExpr` / `visibleLonExpr` in SQL: exact at `precise` and above,
otherwise the stable fuzzed point. `properties` are the serialized location
**without** `point`. At `precise` and above, a location with an outline gets a
second Feature whose geometry is the polygon and whose properties are
`{ "kind": "outline", "locationId": "…", "name": "…" }`.

## Journals

`journals/<visited_on>-<location-slug>-<visit-id>.md` has a small YAML front
matter (`date`, `location`, `people`, `conditions`) followed by the raw
Markdown for visits the exporter authored or may edit. For other visits the
body is omitted and a German note says so; the sanitized HTML remains in
`data/visits.json`.

## Photos

Admin exports contain the ORIGINAL of every ready photo (extension from its
MIME type). Member exports contain originals only for photos they uploaded;
every other photo is the metadata-free 2560 px WebP derivative, named
`photos/<photo-id>.webp`. Photos still `processing` or `failed`, and files
missing on disk, have no entry; their ids and reasons are in
`manifest.json` → `skippedPhotos`.

## Scopes

Scope follows `exportScope(ctx)` (DESIGN §3.5):

- **all** (admin): every location, visit, photo, grant, category, tag,
  history entry, comment, trip and all equipment; only the referenced users'
  names.
- **own_and_visible** (member): exactly the rows of
  `visibleLocationsWhere`, `visibleVisitsWhere`, `visiblePhotosWhere`,
  `visibleHistoryWhere`, `visibleCommentsWhere` and `visibleTripsWhere`.
  Grants only on managed locations; equipment and templates only their own.
- **none** (guest): no export; the endpoint answers 404. Signed-out callers
  get 401.

Never in any export: password hashes, accounts, sessions, passkeys,
verifications, invite token hashes, `auth_email`, `email_verified`, `image`,
jobs, settings secrets or notifications.

## Tickets and limits

At most two exports run at once (one per user). `/admin/export` reserves a slot
with `reserveExportFn` and opens `?ticket=…`, which must be claimed within 60
seconds; API clients call without a ticket. Busy answers are 429
(`EXPORT_BUSY` / `EXPORT_LIMIT`), a bad or used ticket is 409
(`EXPORT_TICKET_INVALID`). Each finished or aborted export writes one
`export.created` audit event with counts only.
