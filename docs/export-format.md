# Export archive format (version 2)

`GET /api/v1/export` returns one ZIP (`trespass-export_YYYY-MM-DD_HH-MM.zip`,
UTC). This is the contract for readers.

- Writer: `apps/server/src/export/build.ts` (`PATHS` lists the files).
- **Changing a file or field's meaning?** Bump `EXPORT_FORMAT_VERSION` in
  `packages/shared/src/export/types.ts`.
- v2 vs v1: no `exact` / `fuzzRadiusM` fields; points, notes and photo GPS
  are always exact.

## Container

- Standard ZIP; ZIP64 records when needed (> 4 GiB). Data descriptors
  (bit 3), UTF-8 names (bit 11). JSON/Markdown deflated, photos stored.
- Streamed with backpressure from one read-only DB snapshot. Entry order is
  not part of the format.
- `writeExport({ now })` pins timestamps and `exportedAt`: an unchanged DB
  yields a byte-identical archive.

## Layout

```
locations.geojson          FeatureCollection: one point per visible location
manifest.json              format version, time, exporter, scope, counts, files
data/locations.json        serialized locations (with `point`)
data/categories.json       seeded categories
data/tags.json             tags
data/visits.json           visit DTOs (people, conditions, sanitized HTML)
data/photos.json           photo DTOs (GPS when the photo has it)
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
  "formatVersion": 2,
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

- Read paths from `files`; don't hard-code them.
- `snapshot: true`: all JSON files come from one DB snapshot.

## JSON files

- Each `data/*.json` is an array, one record per line.
- Ids: DB ids (UUIDv7). Timestamps: ISO 8601 UTC. Visit dates: `YYYY-MM-DD`
  in the location's time zone.

| File | Content |
| --- | --- |
| locations | `serializeLocation` output: exact `point`, `level`, `permissions`, effective `status` |
| categories, tags | Reference tables |
| visits | Visit DTOs incl. `people`, `conditions`, `journalHtml`; `journalMd` only where the exporter may edit |
| photos | Photo DTOs; `gps`/`suggestion` when present; `originalUrl` only for uploader and admins |
| grants | `locationId`, `principalKind`, `principalId`, `level` — managed locations only |
| users | `{ id, displayName }` of referenced users. No e-mail, role or auth fields |
| history | Entries with `sources` (URL, title, day, excerpt, Wayback copy). Approved entries; drafts only with `edit` |
| comments | `targetKind`, `targetId`, `parentId`, `bodyHtml`; `bodyMd` only for the author. Deleted: empty body |
| trips | Owned or listed trips (admin: all). `stops` only visible locations at the exporter's level; contact, people, `checklist`, report; `reportMd` only for editors |
| equipment, pack-templates | Own gear and templates (`equipmentIds`); admin: everyone's (`ownerId`) |

`locations.geojson`:

- One `Point` Feature per location (exact point); `properties` = serialized
  location without `point`.
- Locations with an outline add a polygon Feature with
  `{ "kind": "outline", "locationId": "…", "name": "…" }`.

## Journals

`journals/<visited_on>-<location-slug>-<visit-id>.md`: YAML front matter
(`date`, `location`, `people`, `conditions`), then the raw Markdown — only for
visits the exporter authored or may edit. Otherwise a German note replaces
the body (HTML stays in `data/visits.json`).

## Photos

- Admin: originals of every ready photo (extension from MIME type).
- Member: originals of own uploads; others as metadata-free 2560 px WebP
  (`photos/<photo-id>.webp`).
- `processing`, `failed` or missing files: no entry; listed in
  `manifest.json` → `skippedPhotos`.

## Scopes

`exportScope(ctx)` (DESIGN §3.5):

| Scope | Who | Contents |
| --- | --- | --- |
| `all` | admin | Everything; only referenced users' names |
| `own_and_visible` | member | Rows of the `visible*Where` predicates (locations, visits, photos, history, comments, trips); grants on managed locations; own equipment |
| `none` | guest | 404 (signed out: 401) |

**Never exported**: password hashes, accounts, sessions, passkeys,
verifications, invite token hashes, `auth_email`, `email_verified`, `image`,
jobs, settings secrets, notifications.

**Research working data** is not exported (`search_areas`, `research_runs`,
`candidates`, `research_watch`, `http_cache`). Accepted results are ordinary
locations/history. `history.json` keeps `candidateId` as a plain id.

## Tickets and limits

- Max two concurrent exports, one per user.
- `/admin/export` reserves a slot (`reserveExportFn`) and opens `?ticket=…`;
  claim within 60 s. API clients skip the ticket.
- Busy → 429 (`EXPORT_BUSY` / `EXPORT_LIMIT`). Bad or used ticket → 409
  (`EXPORT_TICKET_INVALID`).
- Each finished or aborted export audits `export.created` (counts only).
