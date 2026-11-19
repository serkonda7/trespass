// The one row mapper for list/map/search results. Queries that AND
// visibleLocationsWhere(ctx) and take coordinates from visibleLatExpr /
// visibleLonExpr hand their rows here; nothing is filtered in JS (the level
// check is a safety net, not a filter). Shared by listLocations and
// searchLocations so both produce identical LocationListItem values.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type {
  LocationListItem,
  LocationStatus,
  StoredLocationStatus,
} from "@trespass/shared/locations/types";
import { locationLevels, type VisibleLevel } from "../authz";
import { canSeeExact } from "../authz/levels";
import type { AppDb } from "../db/client";
import { categories } from "../db/schema";
import { LocationsError } from "./errors";

export type LocationListRow = {
  id: string;
  name: string;
  categoryId: string;
  status: StoredLocationStatus;
  effectiveStatus: LocationStatus;
  country: string | null;
  ownerId: string;
  visibility: "private" | "friends";
  friendsLevel: "view" | "contribute" | "precise";
  visibleLat: number;
  visibleLon: number;
  visibleDistSq: number | null;
};

export type Cursor = { id: string; dist?: number };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Cursor).id === "string" &&
      ((value as Cursor).dist === undefined || typeof (value as Cursor).dist === "number")
    ) {
      return value as Cursor;
    }
  } catch {
    // Fall through to the explicit error.
  }
  throw new LocationsError(422, "CURSOR_INVALID");
}

export { decodeCursor, encodeCursor };

/** Serializes one page of raw SQL rows into the public list-item shape. */
export function toLocationListItems(
  db: AppDb,
  ctx: AuthCtx,
  rows: readonly LocationListRow[],
): LocationListItem[] {
  const levels = locationLevels(db, ctx, rows);
  const catRows = db
    .select({
      id: categories.id,
      key: categories.key,
      icon: categories.icon,
    })
    .from(categories)
    .all();
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const out: LocationListItem[] = [];
  for (const row of rows) {
    const level = levels.get(row.id);
    if (level === undefined || level === "none") continue; // safety net, not a filter
    const cat = catById.get(row.categoryId);
    out.push({
      id: row.id,
      name: row.name,
      categoryKey: cat?.key ?? "",
      categoryIcon: cat?.icon ?? "",
      status: row.effectiveStatus,
      storedStatus: row.status,
      point: { lat: row.visibleLat, lon: row.visibleLon },
      exact: canSeeExact(level),
      level: level as VisibleLevel,
      country: row.country,
    });
  }
  return out;
}
