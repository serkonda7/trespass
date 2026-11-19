// Location permission levels and the resolution rules of DESIGN §3.3.
// Pure functions: no database access. The SQL twin lives in ./predicates.ts;
// property tests keep the two in sync.

import type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
import type { Location, LocationGrant } from "../db/schema";

/** `none < view < contribute < precise < edit < manage` (DESIGN §3.2). */
export const LEVELS = ["none", "view", "contribute", "precise", "edit", "manage"] as const;
export type Level = (typeof LEVELS)[number];
/** Any level that lets the caller see the location at all. */
export type VisibleLevel = Exclude<Level, "none">;
/** Levels a `friends_level` column may hold (DESIGN §9). */
export const FRIENDS_LEVELS = ["view", "contribute", "precise"] as const;
export type FriendsLevel = (typeof FRIENDS_LEVELS)[number];

const RANK: Record<Level, number> = {
  none: 0,
  view: 1,
  contribute: 2,
  precise: 3,
  edit: 4,
  manage: 5,
};

export const levelRank = (lvl: Level): number => RANK[lvl];
export const atLeast = (lvl: Level, min: Level): boolean => RANK[lvl] >= RANK[min];
export const maxLevel = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);
export const minLevel = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);
export const isVisible = (lvl: Level): lvl is VisibleLevel => lvl !== "none";

/** Grant levels (as stored in location_grants.level) that are >= min. */
export function grantLevelsAtLeast(min: Level): Exclude<Level, "none">[] {
  return LEVELS.filter((l): l is Exclude<Level, "none"> => l !== "none" && atLeast(l, min));
}

/** `friends_level` values that are >= min (empty above `precise`). */
export function friendLevelsAtLeast(min: Level): FriendsLevel[] {
  return FRIENDS_LEVELS.filter((l) => atLeast(l, min));
}

/** The highest level a role can ever reach on a location (DESIGN §3.3, last row). */
export const ROLE_CEILING: Record<Role, Level> = {
  admin: "manage",
  member: "manage",
  guest: "view",
};

/** The location columns the resolution rules read. */
export type LocationAuthFields = Pick<Location, "id" | "ownerId" | "visibility" | "friendsLevel">;

/** A grant as the rules need it; a grant for another location is ignored. */
export type GrantRef = Pick<LocationGrant, "principalKind" | "principalId" | "level"> & {
  locationId?: string;
};

/**
 * The highest level any of the grants gives ctx (directly or via a group).
 * Not capped by the role ceiling; `locationLevel` does that.
 */
export function grantLevel(
  ctx: Pick<AuthCtx, "userId" | "groupIds">,
  grants: readonly GrantRef[],
  locationId?: string,
): Level {
  let lvl: Level = "none";
  for (const g of grants) {
    if (locationId !== undefined && g.locationId !== undefined && g.locationId !== locationId)
      continue;
    const applies =
      (g.principalKind === "user" && g.principalId === ctx.userId) ||
      (g.principalKind === "group" && ctx.groupIds.has(g.principalId));
    if (applies) lvl = maxLevel(lvl, g.level);
  }
  return lvl;
}

/**
 * The caller's level on one location: the literal resolution of DESIGN §3.3.
 * Admins are always `manage`; otherwise ownership, `friends_level` and grants
 * are combined by maximum, then capped at the role's ceiling.
 */
export function locationLevel(
  ctx: AuthCtx,
  loc: LocationAuthFields,
  grants: readonly GrantRef[],
): Level {
  if (ctx.role === "admin") return "manage";
  let lvl: Level = loc.ownerId === ctx.userId ? "manage" : "none";
  if (lvl !== "manage" && loc.visibility === "friends") lvl = loc.friendsLevel;
  lvl = maxLevel(lvl, grantLevel(ctx, grants, loc.id));
  return minLevel(lvl, ROLE_CEILING[ctx.role]);
}

/** Exact coordinates (and their derivatives) need at least `precise` (DESIGN §3.2). */
export const canSeeExact = (lvl: Level): boolean => atLeast(lvl, "precise");
