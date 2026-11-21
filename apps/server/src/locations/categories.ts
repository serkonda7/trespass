// The seeded location categories (DESIGN §2). Seeding happens idempotently at
// process startup in nitro/startup.ts (not in a migration): keys and ids are
// stable, `onConflictDoNothing()` keeps admin edits, and a fresh test database
// gets the same rows without hand-editing generated SQL.

import type { CategoryRow } from "@trespass/shared/locations/types";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDb, DbOrTx } from "../db/client";
import { categories } from "../db/schema";

export type SeedCategory = {
  key: string;
  name: string;
  icon: string;
  sort: number;
  /** Earlier seeded names; a row still carrying one is renamed on startup. */
  previousNames?: readonly string[];
};

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { key: "industry", name: "Industrie", icon: "factory", sort: 10 },
  {
    key: "sanatorium",
    name: "Krankenhaus",
    icon: "hospital",
    sort: 20,
    previousNames: ["Heilstätte/Krankenhaus"],
  },
  { key: "military", name: "Militär", icon: "shield", sort: 30, previousNames: ["Militär/Bunker"] },
  { key: "villa", name: "Wohnhaus", icon: "home", sort: 40, previousNames: ["Villa/Wohnhaus"] },
  { key: "hotel", name: "Hotel", icon: "hotel", sort: 50, previousNames: ["Hotel/Gastronomie"] },
  { key: "railway", name: "Bahn", icon: "train", sort: 60, previousNames: ["Bahn/Verkehr"] },
  { key: "church", name: "Kirche", icon: "church", sort: 70, previousNames: ["Kirche/Kloster"] },
  { key: "leisure", name: "Freizeit", icon: "ticket", sort: 80 },
  { key: "agriculture", name: "Landwirtschaft", icon: "wheat", sort: 90 },
  { key: "other", name: "Sonstiges", icon: "circle", sort: 100 },
];

/**
 * Inserts the ten categories if they are missing and renames rows that still
 * carry an earlier seeded name. Admin renames survive. Safe on every start.
 */
export function seedCategories(db: DbOrTx): void {
  for (const c of SEED_CATEGORIES) {
    if (!c.previousNames?.length) continue;
    db.update(categories)
      .set({ name: c.name })
      .where(and(eq(categories.key, c.key), inArray(categories.name, [...c.previousNames])))
      .run();
  }
  db.insert(categories)
    .values(
      SEED_CATEGORIES.map((c) => ({
        id: `cat-${c.key}`,
        key: c.key,
        name: c.name,
        icon: c.icon,
        sort: c.sort,
      })),
    )
    .onConflictDoNothing()
    .run();
}

export function listCategories(db: AppDb): CategoryRow[] {
  return db
    .select({
      id: categories.id,
      key: categories.key,
      name: categories.name,
      icon: categories.icon,
    })
    .from(categories)
    .orderBy(asc(categories.sort), asc(categories.key))
    .all();
}
