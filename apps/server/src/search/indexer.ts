// Keeps locations_fts in step with the locations table (DESIGN §5.9). Every
// application write path that changes an indexed field calls reindexLocations
// inside its own transaction: createLocation, updateLocation (also tag edits),
// the reverse-geocode handler (country/admin_area) and deleteLocation.
//
// PRIVACY (DESIGN §3.4, §5.9): the index holds ONLY data visible at level
// `view` — name, description, tag names and place (country + admin area).
// access_notes, danger_notes, parking, coordinates and all photo / visit text
// are deliberately never indexed: otherwise a search box would become an
// oracle for details beyond the view level. `history` holds the text of APPROVED
// history entries only (drafts need `edit` and must not be findable).
// Index text and query both go through the same normalizeSearchText helper.

import { normalizeSearchText } from "@trespass/shared/normalize";
import { eq, inArray, sql } from "drizzle-orm";
import type { AppDb, DbOrTx } from "../db/client";
import { type Location, locations, locationTags, tags } from "../db/schema";
import { approvedHistoryTexts } from "../history/texts";
import { locationsFts } from "./fts";

const CHUNK = 400;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

export type SearchDocument = {
  name: string;
  description: string;
  history: string;
  tags: string;
  place: string;
};

/** The five indexed columns of one location (all view-level). */
export function searchDocument(
  loc: Pick<Location, "name" | "description" | "country" | "adminArea">,
  tagNames: readonly string[],
  historyTexts: readonly string[] = [],
): SearchDocument {
  return {
    name: normalizeSearchText(loc.name),
    description: normalizeSearchText(loc.description ?? ""),
    history: normalizeSearchText(historyTexts.join(" ")),
    tags: normalizeSearchText(tagNames.join(" ")),
    place: normalizeSearchText([loc.country, loc.adminArea].filter(Boolean).join(" ")),
  };
}

/** Removes rows from the index (deleted locations). */
export function removeFromIndex(db: DbOrTx, ids: readonly string[]): void {
  for (const part of chunks([...new Set(ids)]))
    db.delete(locationsFts).where(inArray(locationsFts.locationId, part)).run();
}

/**
 * (Re)writes the index rows of the given locations from their current state.
 * Ids that no longer exist are removed from the index. Call this inside the
 * same transaction as the location/tag write.
 */
export function reindexLocations(db: DbOrTx, ids: readonly string[]): void {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  for (const part of chunks(unique)) {
    const rows = db.select().from(locations).where(inArray(locations.id, part)).all();
    const tagRows = db
      .select({ locationId: locationTags.locationId, name: tags.name })
      .from(locationTags)
      .innerJoin(tags, eq(tags.id, locationTags.tagId))
      .where(inArray(locationTags.locationId, part))
      .all();
    const tagsOf = new Map<string, string[]>();
    for (const t of tagRows)
      tagsOf.set(t.locationId, [...(tagsOf.get(t.locationId) ?? []), t.name]);
    const historyOf = approvedHistoryTexts(db, part);
    db.delete(locationsFts).where(inArray(locationsFts.locationId, part)).run();
    for (const loc of rows) {
      db.insert(locationsFts)
        .values({
          locationId: loc.id,
          ...searchDocument(loc, tagsOf.get(loc.id) ?? [], historyOf.get(loc.id) ?? []),
        })
        .run();
    }
  }
}

/** Drops and rewrites the whole index. Returns the number of indexed locations. */
export function rebuildSearchIndex(db: AppDb): number {
  return db.transaction((tx) => {
    tx.delete(locationsFts).run();
    const ids = tx
      .select({ id: locations.id })
      .from(locations)
      .all()
      .map((r) => r.id);
    reindexLocations(tx, ids);
    return ids.length;
  });
}

/** True when the index does not cover exactly the locations table. */
export function searchIndexOutOfStep(db: DbOrTx): boolean {
  const row = db
    .select({
      locations: sql<number>`(select count(*) from ${locations})`,
      indexed: sql<number>`(select count(*) from ${locationsFts})`,
      distinct: sql<number>`(select count(distinct ${locationsFts.locationId}) from ${locationsFts})`,
      missing: sql<number>`(select count(*) from ${locations} where ${locations.id} not in (select ${locationsFts.locationId} from ${locationsFts}))`,
    })
    .from(sql`(select 1)`)
    .get();
  if (!row) return false;
  return row.locations !== row.indexed || row.indexed !== row.distinct || row.missing > 0;
}

/** Rebuilds the index when it is out of step. Returns true when it rebuilt. */
export function ensureSearchIndex(db: AppDb): boolean {
  if (!searchIndexOutOfStep(db)) return false;
  rebuildSearchIndex(db);
  return true;
}
