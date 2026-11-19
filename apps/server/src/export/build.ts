// Builds the export archive (DESIGN §3.4 rules 2/5/6, §3.5, §5.10) and streams
// it through a ByteWriter. Layout: docs/export-format.md.
//
// Scope comes only from the authz SQL predicates: visibleLocationsWhere,
// visibleVisitsWhere and visiblePhotosWhere. Nothing is filtered in JS.
// Coordinates come from visibleLatExpr/visibleLonExpr, and locations go through
// serializeLocation, so a viewer below `precise` gets one stable fuzzed point
// and never an outline, notes, fuzz radius or exact photo GPS.
//
// Memory: data is read in pages from a single read snapshot and written as it
// is read; files are streamed in 256 KiB chunks; between pages the loop yields
// to the event loop so other requests keep being served.
import { open } from "node:fs/promises";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportCounts,
  type ExportProgress,
  type ExportScopeName,
} from "@trespass/shared/export/types";
import type { LocationStatus, SerializedLocation } from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { and, asc, gt, inArray, sql } from "drizzle-orm";
import { HttpError } from "../auth/context";
import {
  canSeePhotoOriginal,
  exportScope,
  locationLevels,
  serializeLocation,
  visibleLatExpr,
  visibleLocationsWhere,
  visibleLonExpr,
} from "../authz";
import type { AppDb } from "../db/client";
import {
  categories,
  type Location,
  locationGrants,
  locations,
  locationTags,
  tags,
  users,
} from "../db/schema";
import { effectiveStatusExpr } from "../locations/status";
import type { PhotoExportRow } from "../photos/service";
import { photoPagesForExport } from "../photos/service";
import type { PhotoStore } from "../photos/storage";
import { visitPagesForExport } from "../visits/service";
import { photoExtension, slug } from "./paths";
import { openSnapshot } from "./snapshot";
import type { ByteWriter } from "./stream";
import { ZipWriter } from "./zip";

/** Archive paths (format version 1). */
export const PATHS = {
  geojson: "locations.geojson",
  manifest: "manifest.json",
  locations: "data/locations.json",
  categories: "data/categories.json",
  tags: "data/tags.json",
  visits: "data/visits.json",
  photos: "data/photos.json",
  grants: "data/grants.json",
  users: "data/users.json",
  journalsDir: "journals",
  photosDir: "photos",
} as const;

const FILE_CHUNK = 256 * 1024;
const TEXT_FLUSH = 64 * 1024;
const enc = new TextEncoder();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

type LocationRow = {
  location: Location;
  visibleLat: number;
  visibleLon: number;
  effectiveStatus: LocationStatus;
};

export type ExportOptions = {
  db: AppDb;
  ctx: AuthCtx;
  store: PhotoStore;
  /** Fully injectable: ZIP timestamps, file name and manifest agree. */
  now?: Date;
  /** Rows per database page (default 500). */
  pageSize?: number;
  forceZip64?: boolean;
  /** Mutated while the export runs (the export page polls it). */
  progress?: ExportProgress;
  appVersion?: string;
};

export type ExportResult = { scope: ExportScopeName; counts: ExportCounts; bytes: number };

export type SkippedPhoto = { id: string; reason: "processing" | "failed" | "missing" };

export async function writeExport(write: ByteWriter, o: ExportOptions): Promise<ExportResult> {
  const scope = exportScope(o.ctx);
  if (scope === "none") throw new HttpError(404, "NOT_FOUND");
  const snap = openSnapshot(o.db);
  try {
    return await build(write, o, scope, snap.db, snap.isolated);
  } finally {
    snap.close();
  }
}

async function build(
  write: ByteWriter,
  o: ExportOptions,
  scope: ExportScopeName,
  db: AppDb,
  isolated: boolean,
): Promise<ExportResult> {
  const { ctx } = o;
  const isAdmin = scope === "all";
  const pageSize = o.pageSize ?? 500;
  const now = o.now ?? new Date();
  const progress = o.progress;
  const setPhase = (phase: ExportProgress["phase"]) => {
    if (progress) progress.phase = phase;
  };
  const zip = new ZipWriter(
    async (chunk) => {
      await write(chunk);
      if (progress) progress.bytesWritten = zip.bytesWritten;
    },
    { date: now, forceZip64: o.forceZip64 },
  );

  const counts: ExportCounts = {
    locations: 0,
    categories: 0,
    tags: 0,
    visits: 0,
    journals: 0,
    photos: 0,
    photoFiles: 0,
    skippedPhotos: 0,
    grants: 0,
    users: 0,
  };
  const skipped: SkippedPhoto[] = [];
  /** Only users referenced by exported data (never auth/session fields). */
  const referencedUsers = new Set<string>([ctx.userId]);
  const noteUser = (id: string | null | undefined) => {
    if (id) referencedUsers.add(id);
  };

  async function textEntry(path: string) {
    const entry = await zip.begin(path, { compress: true });
    let parts: string[] = [];
    let len = 0;
    const flush = async () => {
      if (len === 0) return;
      const s = parts.join("");
      parts = [];
      len = 0;
      await entry.write(enc.encode(s));
    };
    return {
      async put(s: string) {
        parts.push(s);
        len += s.length;
        if (len >= TEXT_FLUSH) await flush();
      },
      async close() {
        await flush();
        return entry.close();
      },
    };
  }

  async function jsonArray(path: string, pages: AsyncIterable<unknown[]> | Iterable<unknown[]>) {
    const w = await textEntry(path);
    let n = 0;
    await w.put("[");
    for await (const page of pages)
      for (const rec of page) await w.put(`${n++ ? "," : ""}\n${JSON.stringify(rec)}`);
    await w.put(n ? "\n]\n" : "]\n");
    await w.close();
    return n;
  }

  async function jsonValue(path: string, value: unknown) {
    const w = await textEntry(path);
    await w.put(`${JSON.stringify(value, null, 2)}\n`);
    await w.close();
  }

  // --- Reference data --------------------------------------------------------
  const categoryRows = db
    .select({
      id: categories.id,
      key: categories.key,
      name: categories.name,
      icon: categories.icon,
    })
    .from(categories)
    .orderBy(asc(categories.sort), asc(categories.key))
    .all();
  const categoryById = new Map(categoryRows.map((c) => [c.id, c]));
  const tagRows = db.select().from(tags).orderBy(asc(tags.name)).all();
  const userById = new Map(
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u]),
  );

  /** All visible locations, paged by id, with SQL-computed visible coordinates. */
  async function* locationPages() {
    let after = "";
    for (;;) {
      const rows = db
        .select({
          location: locations,
          visibleLat: sql<number>`${visibleLatExpr(ctx)}`.as("visible_lat"),
          visibleLon: sql<number>`${visibleLonExpr(ctx)}`.as("visible_lon"),
          effectiveStatus: sql<LocationStatus>`${effectiveStatusExpr()}`.as("effective_status"),
        })
        .from(locations)
        .where(and(visibleLocationsWhere(ctx, locations), gt(locations.id, after)))
        .orderBy(asc(locations.id))
        .limit(pageSize)
        .all();
      if (rows.length === 0) return;
      after = rows[rows.length - 1]?.location.id ?? after;
      const levels = locationLevels(
        db,
        ctx,
        rows.map((r) => r.location),
      );
      const tagMap = new Map<string, string[]>();
      for (const t of db
        .select()
        .from(locationTags)
        .where(
          inArray(
            locationTags.locationId,
            rows.map((r) => r.location.id),
          ),
        )
        .all()) {
        const list = tagMap.get(t.locationId);
        if (list) list.push(t.tagId);
        else tagMap.set(t.locationId, [t.tagId]);
      }
      const out: { row: LocationRow; dto: SerializedLocation }[] = [];
      for (const row of rows) {
        const level = levels.get(row.location.id);
        if (!level || level === "none") continue;
        noteUser(row.location.ownerId);
        out.push({
          row,
          dto: serializeLocation(row.location, level, {
            category: categoryById.get(row.location.categoryId) ?? null,
            tags: tagMap.get(row.location.id) ?? [],
            ownerName: userById.get(row.location.ownerId)?.displayName ?? null,
            effectiveStatus: row.effectiveStatus,
          }),
        });
      }
      yield out;
      await tick();
    }
  }

  // --- locations.geojson -----------------------------------------------------
  setPhase("data");
  {
    const w = await textEntry(PATHS.geojson);
    await w.put('{"type":"FeatureCollection","features":[');
    let n = 0;
    for await (const page of locationPages())
      for (const { row, dto } of page) {
        if (n++) await w.put(",");
        const { point: _point, ...properties } = dto;
        await w.put(
          JSON.stringify({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [row.visibleLon, row.visibleLat],
            },
            properties,
          }),
        );
        // The outline is exact data: only a precise viewer gets this feature.
        if (dto.exact && row.location.geomArea) {
          await w.put(
            `,${JSON.stringify({
              type: "Feature",
              geometry: row.location.geomArea,
              properties: { kind: "outline", locationId: dto.id, name: dto.name },
            })}`,
          );
        }
      }
    await w.put("]}\n");
    await w.close();
  }

  // --- data/locations.json ---------------------------------------------------
  const levels = new Map<string, string>();
  counts.locations = await jsonArray(
    PATHS.locations,
    (async function* () {
      for await (const page of locationPages()) {
        for (const { dto } of page) levels.set(dto.id, dto.level);
        yield page.map((p) => p.dto);
      }
    })(),
  );
  counts.categories = await jsonArray(PATHS.categories, [categoryRows]);
  counts.tags = await jsonArray(PATHS.tags, [tagRows]);

  // --- data/visits.json ------------------------------------------------------
  counts.visits = await jsonArray(
    PATHS.visits,
    (async function* () {
      for await (const page of visitPagesForExport(db, ctx, Math.min(pageSize, 100))) {
        for (const v of page) {
          noteUser(v.authorId);
          for (const p of v.people) noteUser(p.userId);
        }
        yield page;
      }
    })(),
  );

  setPhase("files");
  // The journals are a second pass over the same SQL-visible rows: one Markdown
  // file per visit. Raw markdown only for visits the exporter may edit; for
  // everyone else the body is withheld (the JSON still has sanitized HTML).
  if (progress) progress.filesTotal = counts.visits;
  for await (const page of visitPagesForExport(db, ctx, Math.min(pageSize, 100))) {
    for (const v of page) {
      const front = [
        "---",
        `date: ${JSON.stringify(v.visitedOn)}`,
        `location: ${JSON.stringify(v.location?.name ?? m.export_journal_no_location())}`,
        `people: ${JSON.stringify(v.people.map((p) => p.displayName))}`,
        `conditions: ${JSON.stringify(v.conditions)}`,
        "---",
        "",
      ].join("\n");
      const body =
        v.journalMd !== undefined ? `${v.journalMd}\n` : `${m.export_journal_withheld()}\n`;
      const path = `${PATHS.journalsDir}/${v.visitedOn}-${slug(v.location?.name, "ohne-ort")}-${v.id}.md`;
      await zip.add(path, [enc.encode(`${front}\n${body}`)], { compress: true });
      counts.journals++;
      if (progress) progress.filesDone++;
    }
    await tick();
  }

  // --- data/photos.json and the photo files ---------------------------------
  const photoRows: PhotoExportRow[] = [];
  counts.photos = await jsonArray(
    PATHS.photos,
    (async function* () {
      for await (const page of photoPagesForExport(db, ctx, pageSize)) {
        for (const p of page) {
          photoRows.push(p);
          noteUser(p.dto.uploaderId);
        }
        yield page.map((p) => p.dto);
      }
    })(),
  );

  if (progress) progress.filesTotal = counts.photos;
  for (const p of photoRows) {
    if (progress) progress.filesDone++;
    if (p.status !== "ready") {
      skipped.push({ id: p.dto.id, reason: p.status });
      continue;
    }
    const original = canSeePhotoOriginal(ctx, { uploaderId: p.uploaderId });
    const path = `${PATHS.photosDir}/${p.dto.id}${original ? photoExtension(p.mime) : ".webp"}`;
    const file = original ? o.store.blobPath(p.sha256) : o.store.derivedPath(p.sha256, 2560);
    const written = await writeFile(path, file);
    if (written) counts.photoFiles++;
    else skipped.push({ id: p.dto.id, reason: "missing" });
  }
  counts.skippedPhotos = skipped.length;

  /** Streams one existing file into a stored ZIP entry. */
  async function writeFile(path: string, source: string): Promise<boolean> {
    let fh: Awaited<ReturnType<typeof open>>;
    try {
      fh = await open(source, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error("[export] photo file missing", source);
        return false;
      }
      throw err;
    }
    try {
      const { size } = await fh.stat();
      const entry = await zip.begin(path, { compress: false, size });
      for (;;) {
        const buf = new Uint8Array(FILE_CHUNK);
        const { bytesRead } = await fh.read(buf, 0, FILE_CHUNK, null);
        if (bytesRead === 0) break;
        await entry.write(bytesRead === FILE_CHUNK ? buf : buf.subarray(0, bytesRead));
      }
      await entry.close();
      return true;
    } finally {
      await fh.close();
    }
  }

  // --- data/grants.json ------------------------------------------------------
  // Admins manage everything; members only get the grants of locations they
  // manage. The set comes from the levels computed for already-filtered rows.
  const managedIds = isAdmin
    ? null
    : [...levels].filter(([, level]) => level === "manage").map(([id]) => id);
  counts.grants = await jsonArray(
    PATHS.grants,
    (function* () {
      if (!managedIds) {
        const all = db.select().from(locationGrants).orderBy(asc(locationGrants.locationId)).all();
        for (const g of all) if (g.principalKind === "user") noteUser(g.principalId);
        yield all;
        return;
      }
      for (let i = 0; i < managedIds.length; i += 500) {
        const page = db
          .select()
          .from(locationGrants)
          .where(inArray(locationGrants.locationId, managedIds.slice(i, i + 500)))
          .orderBy(asc(locationGrants.locationId))
          .all();
        for (const g of page) if (g.principalKind === "user") noteUser(g.principalId);
        yield page;
      }
    })(),
  );

  // --- data/users.json -------------------------------------------------------
  counts.users = await jsonArray(PATHS.users, [
    [...referencedUsers].sort().flatMap((id) => {
      const u = userById.get(id);
      return u ? [{ id: u.id, displayName: u.displayName }] : [];
    }),
  ]);

  // --- manifest.json ---------------------------------------------------------
  setPhase("finishing");
  const files = {
    geojson: PATHS.geojson,
    locations: PATHS.locations,
    categories: PATHS.categories,
    tags: PATHS.tags,
    visits: PATHS.visits,
    photos: PATHS.photos,
    grants: PATHS.grants,
    users: PATHS.users,
    manifest: PATHS.manifest,
  };
  await jsonValue(PATHS.manifest, {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: o.appVersion ?? "unknown",
    exportedAt: now.toISOString(),
    exportedBy: { id: ctx.userId, role: ctx.role },
    scope,
    snapshot: isolated,
    counts,
    files,
    skippedPhotos: skipped,
  });

  const done = await zip.finish();
  if (progress) progress.bytesWritten = done.bytes;
  return { scope, counts, bytes: done.bytes };
}
