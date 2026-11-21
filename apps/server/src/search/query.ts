// The one list/search query (DESIGN §5.9), used by the map and /suche.
// - FTS5 MATCH for words ≥ 3 chars, `name_sort` prefix for shorter.
// - Visibility always ANDed in SQL; coordinates from visibleLatExpr/LonExpr.
// - Same row mapper and id/distance order as listLocations (shared keyset cursor).

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { splitBbox } from "@trespass/shared/geo/distance";
import {
  DEFAULT_PAGE_SIZE,
  type ListLocationsInput,
  listLocationsInput,
} from "@trespass/shared/locations/inputs";
import type { LocationListItem, LocationStatus } from "@trespass/shared/locations/types";
import { normalizeSearchText } from "@trespass/shared/normalize";
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { visibleLatExpr, visibleLocationsWhere, visibleLonExpr } from "../authz";
import type { AppDb } from "../db/client";
import { locations, locationTags, tags } from "../db/schema";
import { parseInput } from "../locations/errors";
import {
  decodeCursor,
  encodeCursor,
  type LocationListRow,
  toLocationListItems,
} from "../locations/list-rows";
import { effectiveStatusExpr } from "../locations/status";
import { locationsFts } from "./fts";
import { ensureSearchIndex } from "./indexer";

export const SEARCH_MIN_FTS = 3;

export type PreparedText = {
  mode: "all" | "fts" | "prefix";
  /** FTS5 MATCH expression: quoted phrases ANDed, never raw user syntax. */
  match: string | null;
  /** Normalized words shorter than three characters. */
  short: string[];
};

/**
 * Turns user text into safe FTS5 syntax. Every word becomes a quoted phrase
 * (embedded `"` doubled), so operators like AND, NEAR(, *, - or : are treated
 * as plain text and cannot throw or change the query's meaning. Words below
 * the trigram tokenizer's minimum are looked up in name_sort instead.
 */
export function prepareSearchText(q: string | undefined): PreparedText {
  const words = normalizeSearchText(q ?? "")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return { mode: "all", match: null, short: [] };
  const long = words.filter((w) => [...w].length >= SEARCH_MIN_FTS);
  const short = words.filter((w) => [...w].length < SEARCH_MIN_FTS);
  if (long.length === 0) return { mode: "prefix", match: null, short };
  return { mode: "fts", match: long.map((w) => `"${w.replaceAll('"', '""')}"`).join(" "), short };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function textCondition(p: PreparedText): SQL | undefined {
  if (p.mode === "all") return undefined;
  if (p.mode === "prefix") {
    return and(
      ...p.short.map(
        (w) =>
          sql`(${locations.nameSort} like ${`${likeEscape(w)}%`} escape '\\' or ${locations.nameSort} like ${`% ${likeEscape(w)}%`} escape '\\')`,
      ),
    ) as SQL;
  }
  // The IN form keeps the visibility predicate and the cursor on `locations`.
  const match = sql`${locations.id} in (select ${locationsFts.locationId} from ${locationsFts} where ${locationsFts} match ${p.match})`;
  return and(match, ...p.short.map((w) => sql`instr(${locations.nameSort}, ${w}) > 0`)) as SQL;
}

export type LocationList = { rows: LocationListItem[]; nextCursor: string | null };

// Startup backfills the index; tests open databases directly, so check once
// per connection before the first search (a restore or a raw test insert is
// picked up too). Writes from the application keep the index in step.
const checked = new WeakSet<AppDb>();

function ready(db: AppDb): void {
  if (checked.has(db)) return;
  checked.add(db);
  ensureSearchIndex(db);
}

/** List locations with the same filters as the map, with full-text `q`. */
export function searchLocations(db: AppDb, ctx: AuthCtx, raw: ListLocationsInput): LocationList {
  ready(db);
  const input = parseInput(listLocationsInput, raw);
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(input.cursor);
  const conditions: SQL[] = [visibleLocationsWhere(ctx)];
  const text = textCondition(prepareSearchText(input.q));
  if (text) conditions.push(text);
  if (input.status?.length) {
    // Filter the EFFECTIVE status in SQL, so `visited` works and no JS pass
    // over the rows can disagree with the returned status (DESIGN §2).
    const eff = effectiveStatusExpr();
    conditions.push(
      sql`${eff} in (${sql.join(
        input.status.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  if (input.categoryId?.length) conditions.push(inArray(locations.categoryId, input.categoryId));
  if (input.country?.length) conditions.push(inArray(locations.country, input.country));
  if (input.tag?.length) {
    const names = input.tag.map(normalizeSearchText);
    conditions.push(
      sql`exists (select 1 from ${locationTags} inner join ${tags} on ${eq(
        tags.id,
        locationTags.tagId,
      )} where ${eq(locationTags.locationId, locations.id)} and ${inArray(tags.name, names)})`,
    );
  }

  const latExpr = visibleLatExpr(ctx);
  const lonExpr = visibleLonExpr(ctx);
  if (input.bbox) {
    const boxes = splitBbox(input.bbox);
    const boxConditions = boxes.map(
      (b) =>
        and(
          sql`${latExpr} between ${b.minLat} and ${b.maxLat}`,
          sql`${lonExpr} between ${b.minLon} and ${b.maxLon}`,
        ) as SQL,
    );
    conditions.push(or(...boxConditions) as SQL);
  }

  // Equirectangular approximation in SQL, over the VISIBLE coordinates only:
  // coordinates always come from the shared expression (DESIGN §3.4 rule 2).
  let distSq: SQL | null = null;
  if (input.near) {
    const metersPerLon = 111_320 * Math.cos((input.near.lat * Math.PI) / 180);
    const dx = sql`((${lonExpr} - ${input.near.lon}) * ${metersPerLon})`;
    const dy = sql`((${latExpr} - ${input.near.lat}) * ${111_320})`;
    distSq = sql`(${dx} * ${dx} + ${dy} * ${dy})`;
    if (cursor?.dist !== undefined) {
      conditions.push(
        sql`(${distSq} > ${cursor.dist} or (${distSq} = ${cursor.dist} and ${locations.id} > ${cursor.id}))`,
      );
    } else if (cursor) {
      conditions.push(sql`${locations.id} > ${cursor.id}`);
    }
  } else if (cursor) {
    conditions.push(sql`${locations.id} > ${cursor.id}`);
  }

  const rows = db
    .select({
      id: locations.id,
      name: locations.name,
      categoryId: locations.categoryId,
      status: locations.status,
      effectiveStatus: sql<LocationStatus>`${effectiveStatusExpr()}`.as("effective_status"),
      country: locations.country,
      ownerId: locations.ownerId,
      visibility: locations.visibility,
      friendsLevel: locations.friendsLevel,
      visibleLat: sql<number>`${latExpr}`.as("visible_lat"),
      visibleLon: sql<number>`${lonExpr}`.as("visible_lon"),
      visibleDistSq: distSq
        ? sql<number>`${distSq}`.as("visible_dist_sq")
        : sql<number>`NULL`.as("visible_dist_sq"),
    })
    .from(locations)
    .where(and(...conditions))
    .orderBy(...(distSq ? [sql`${distSq} asc`, asc(locations.id)] : [asc(locations.id)]))
    .limit(limit + 1)
    .all() as LocationListRow[];

  const page = rows.slice(0, limit);
  let nextCursor: string | null = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    const lastRow = rows[page.length - 1];
    nextCursor = encodeCursor({
      id: last.id,
      ...(distSq && lastRow.visibleDistSq != null ? { dist: lastRow.visibleDistSq } : {}),
    });
  }
  return { rows: toLocationListItems(db, ctx, page), nextCursor };
}
