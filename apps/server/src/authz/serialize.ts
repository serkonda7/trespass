// The one place a location turns into what leaves the server (DESIGN §3.4
// rule 4). Anyone who can see a location gets its exact coordinates and all of
// its details. Grants are still limited to `manage`. This happens on the
// server, never in the UI.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type { GeoJsonPolygon } from "@trespass/shared/geo/types";
import type {
  GrantRow,
  LocationCategoryRef,
  LocationPermissions,
  LocationStatus,
  SerializedLocation,
} from "@trespass/shared/locations/types";
import type { AppDb } from "../db/client";
import type { Location } from "../db/schema";
import { atLeast, type Level, type VisibleLevel } from "./levels";
import { type LeveledLocation, locationLevels } from "./load";

export type SerializeExtra = {
  category?: LocationCategoryRef | null;
  tags?: string[];
  ownerName?: string | null;
  /** Only emitted at `manage`; dropped for every lower level. */
  grants?: GrantRow[] | null;
  /** Effective status from the SQL expression; defaults to the stored status. */
  effectiveStatus?: LocationStatus;
};

function permissions(level: VisibleLevel): LocationPermissions {
  return {
    canContribute: atLeast(level, "contribute"),
    canEdit: atLeast(level, "edit"),
    canManage: atLeast(level, "manage"),
  };
}

/**
 * Serializes one location for a caller with `level` (from loadLocationForCtx /
 * locationLevels / withLevels; never make one up). Throws on `none`: an
 * invisible location must never reach serialization.
 */
export function serializeLocation(
  loc: Location,
  level: Level,
  extra: SerializeExtra = {},
): SerializedLocation {
  if (level === "none") throw new Error("serializeLocation: location is not visible to the caller");
  const out: Record<string, unknown> = {
    id: loc.id,
    ownerId: loc.ownerId,
    name: loc.name,
    description: loc.description,
    categoryId: loc.categoryId,
    status: extra.effectiveStatus ?? loc.status,
    storedStatus: loc.status,
    point: { lat: loc.lat, lon: loc.lon },
    country: loc.country,
    adminArea: loc.adminArea,
    tz: loc.tz,
    builtYear: loc.builtYear,
    abandonedYear: loc.abandonedYear,
    coverPhotoId: loc.coverPhotoId,
    visibility: loc.visibility,
    friendsLevel: loc.friendsLevel,
    version: loc.version,
    createdAt: loc.createdAt,
    updatedAt: loc.updatedAt,
    level,
    permissions: permissions(level as VisibleLevel),
    geomArea: loc.geomArea as GeoJsonPolygon | null,
    parking: loc.parking as { lat: number; lon: number }[] | null,
    accessNotes: loc.accessNotes,
    dangerNotes: loc.dangerNotes,
  };
  out.category = extra.category ?? null;
  out.tags = extra.tags ?? [];
  out.ownerName = extra.ownerName ?? null;
  // At `manage` only; grants list must not exist for lower levels.
  if (atLeast(level, "manage")) out.grants = extra.grants ?? null;
  return out as unknown as SerializedLocation;
}

/** Serializes a LeveledLocation (what loadLocationForCtx / withLevels return). */
export function serializeLeveled(
  { location, level }: LeveledLocation,
  extra: SerializeExtra = {},
): SerializedLocation {
  return serializeLocation(location, level, extra);
}

/**
 * Lists: computes the levels of a page of rows (one grants query) and
 * serializes them. Rows must come from a query that ANDed
 * `visibleLocationsWhere(ctx)`; rows below view are dropped as a safety net.
 */
export function serializeLocationsForCtx(
  db: AppDb,
  ctx: AuthCtx,
  rows: readonly Location[],
  extraFor: (loc: Location, level: VisibleLevel) => SerializeExtra = () => ({}),
): SerializedLocation[] {
  const levels = locationLevels(db, ctx, rows);
  const out: SerializedLocation[] = [];
  for (const loc of rows) {
    const level = levels.get(loc.id);
    if (level === undefined || level === "none") continue;
    out.push(serializeLocation(loc, level, extraFor(loc, level)));
  }
  return out;
}
