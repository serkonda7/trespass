// Test-only helpers: insert raw rows (including anomalies the app would never
// write) without password hashing. App code creates users only via invites or
// createUserWithPassword. Categories are seeded once per database.

import type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
import { normalizeSearchText } from "@trespass/shared/normalize";
import type { AppDb } from "../db/client";
import {
  groupMembers,
  groups,
  locationGrants,
  locations,
  type NewLocation,
  type NewLocationGrant,
  users,
} from "../db/schema";
import { seedCategories } from "../locations/categories";

export type SeedUser = { id: string; role: Role; disabled?: boolean };
export type SeedLocation = Partial<Omit<NewLocation, "ownerId">> & {
  id: string;
  ownerId: string;
};
export type Seed = {
  users?: SeedUser[];
  groups?: string[];
  members?: [groupId: string, userId: string][];
  locations?: SeedLocation[];
  grants?: NewLocationGrant[];
  /** Databases used by service tests already seed categories themselves. */
  skipCategories?: boolean;
};

export function seed(db: AppDb, s: Seed): void {
  db.transaction((tx) => {
    if (!s.skipCategories) seedCategories(tx);
    for (const u of s.users ?? []) {
      tx.insert(users)
        .values({
          id: u.id,
          username: `user-${u.id}`,
          displayName: u.id,
          authEmail: `${u.id}@users.invalid`,
          role: u.role,
          disabledAt: u.disabled ? new Date() : null,
        })
        .run();
    }
    for (const g of s.groups ?? [])
      tx.insert(groups)
        .values({ id: g, name: `group-${g}` })
        .run();
    for (const [groupId, userId] of s.members ?? [])
      tx.insert(groupMembers).values({ groupId, userId }).run();
    for (const loc of s.locations ?? []) {
      const row: NewLocation = {
        name: `loc-${loc.id}`,
        nameSort: normalizeSearchText(`loc-${loc.id}`),
        categoryId: "cat-industry",
        lat: 0,
        lon: 0,
        pubLat: 0,
        pubLon: 0,
        fuzzRadiusM: 1500,
        tz: "Etc/UTC",
        ...loc,
      };
      tx.insert(locations).values(row).run();
    }
    for (const g of s.grants ?? []) tx.insert(locationGrants).values(g).run();
  });
}

export const ctxFor = (userId: string, role: Role, groupIds: readonly string[] = []): AuthCtx => ({
  userId,
  role,
  groupIds: new Set(groupIds),
});
