-- Hand-written migration (drizzle-kit cannot model virtual tables).
--
-- Full-text search over locations (DESIGN §5.9, §9). The trigram tokenizer
-- makes substring matches work in German compounds ("heilstätte" finds
-- "Lungenheilstätte"); remove_diacritics folds "ä" to "a" and needs SQLite
-- >= 3.45. `location_id` links back to locations.id and is UNINDEXED, so only
-- the five view-level text columns are searchable.
--
-- PRIVACY: only fields visible at level `view` are stored here. `history` is
-- reserved for a later version and stays empty until history entries exist.
-- Never put access_notes, danger_notes, parking, coordinates, fuzz radius,
-- photo or visit text in this table: search must not become an oracle for
-- precise-only data. Existing rows are backfilled by the idempotent
-- ensureSearchIndex() at startup (and on first search in tests).
CREATE VIRTUAL TABLE `locations_fts` USING fts5(
	location_id UNINDEXED,
	name,
	description,
	history,
	tags,
	place,
	tokenize = 'trigram remove_diacritics 1'
);
