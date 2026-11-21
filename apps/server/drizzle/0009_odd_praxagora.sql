-- Location status `planned` is gone (trips cover planning). Like 0008, keep the
-- old CHECK instead of rebuilding `locations` (a rebuild would cascade-delete
-- through foreign keys and drop 0008's triggers); triggers reject the value.
UPDATE `locations` SET `status` = 'researched' WHERE `status` = 'planned';--> statement-breakpoint
CREATE TRIGGER `locations_status_no_planned_insert` BEFORE INSERT ON `locations`
WHEN NEW.`status` = 'planned' BEGIN
  SELECT RAISE(ABORT, 'location status planned is no longer supported');
END;--> statement-breakpoint
CREATE TRIGGER `locations_status_no_planned_update` BEFORE UPDATE OF `status` ON `locations`
WHEN NEW.`status` = 'planned' BEGIN
  SELECT RAISE(ABORT, 'location status planned is no longer supported');
END;
