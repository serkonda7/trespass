// Drizzle handle for the FTS5 table `locations_fts` (created by the hand-written
// migration drizzle/0004_search_fts.sql). Deliberately NOT in db/schema.ts, so
// drizzle-kit never tries to manage the virtual table. The index is written
// only from ./indexer.ts, which decides which view-level fields are searchable.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const locationsFts = sqliteTable("locations_fts", {
  locationId: text("location_id").notNull(),
  name: text("name"),
  description: text("description"),
  /** Reserved: history entries arrive in a later version; always empty for now. */
  history: text("history"),
  tags: text("tags"),
  /** country + admin_area, both of which are visible at level `view`. */
  place: text("place"),
});
