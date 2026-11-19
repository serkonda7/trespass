// The seeded location categories (DESIGN §2). Seeding happens idempotently at
// process startup in nitro/startup.ts (not in a migration): keys and ids are
// stable, `onConflictDoNothing()` keeps admin edits, and a fresh test database
// gets the same rows without hand-editing generated SQL.

import type { CategoryRow } from "@trespass/shared/locations/types";
import { asc } from "drizzle-orm";
import type { AppDb, DbOrTx } from "../db/client";
import { categories } from "../db/schema";

export type SeedCategory = { key: string; name: string; icon: string; sort: number };

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { key: "industry", name: "Industrie", icon: "factory", sort: 10 },
  { key: "sanatorium", name: "Heilstätte/Krankenhaus", icon: "hospital", sort: 20 },
  { key: "military", name: "Militär/Bunker", icon: "shield", sort: 30 },
  { key: "villa", name: "Villa/Wohnhaus", icon: "home", sort: 40 },
  { key: "hotel", name: "Hotel/Gastronomie", icon: "hotel", sort: 50 },
  { key: "railway", name: "Bahn/Verkehr", icon: "train", sort: 60 },
  { key: "church", name: "Kirche/Kloster", icon: "church", sort: 70 },
  { key: "leisure", name: "Freizeit", icon: "ticket", sort: 80 },
  { key: "agriculture", name: "Landwirtschaft", icon: "wheat", sort: 90 },
  { key: "other", name: "Sonstiges", icon: "circle", sort: 100 },
];

/** Inserts the ten categories if they are missing. Safe to call on every start. */
export function seedCategories(db: DbOrTx): void {
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
