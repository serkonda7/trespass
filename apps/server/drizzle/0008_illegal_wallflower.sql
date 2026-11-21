-- Hand-written migration: drizzle-kit would rebuild `locations`, and dropping
-- that table would cascade into visits, photos, comments, trips, research rows
-- etc. (the migrator's transaction keeps foreign_keys ON). Drop the columns in
-- place instead. SQLite cannot alter a CHECK constraint in place, so the old
-- constraints still list `precise`; the triggers below reject it instead.
--
-- Exact coordinates are visible to everyone who can see a location, so the
-- `precise` tier has no meaning left. Fold existing rows into `contribute`.
UPDATE `locations` SET `friends_level` = 'contribute' WHERE `friends_level` = 'precise';--> statement-breakpoint
UPDATE `location_grants` SET `level` = 'contribute' WHERE `level` = 'precise';--> statement-breakpoint
DROP INDEX IF EXISTS `locations_pub_lat_lon_idx`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `pub_lat`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `pub_lon`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `fuzz_radius_m`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `default_fuzz_m`;--> statement-breakpoint
CREATE TRIGGER `locations_friends_level_no_precise_insert` BEFORE INSERT ON `locations`
WHEN NEW.`friends_level` = 'precise' BEGIN
  SELECT RAISE(ABORT, 'friends_level precise is no longer supported');
END;--> statement-breakpoint
CREATE TRIGGER `locations_friends_level_no_precise_update` BEFORE UPDATE OF `friends_level` ON `locations`
WHEN NEW.`friends_level` = 'precise' BEGIN
  SELECT RAISE(ABORT, 'friends_level precise is no longer supported');
END;--> statement-breakpoint
CREATE TRIGGER `location_grants_level_no_precise_insert` BEFORE INSERT ON `location_grants`
WHEN NEW.`level` = 'precise' BEGIN
  SELECT RAISE(ABORT, 'grant level precise is no longer supported');
END;--> statement-breakpoint
CREATE TRIGGER `location_grants_level_no_precise_update` BEFORE UPDATE OF `level` ON `location_grants`
WHEN NEW.`level` = 'precise' BEGIN
  SELECT RAISE(ABORT, 'grant level precise is no longer supported');
END;
