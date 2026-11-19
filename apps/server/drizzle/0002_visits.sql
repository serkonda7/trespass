CREATE TABLE `visit_people` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`user_id` text,
	`name` text,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visit_people_exactly_one" CHECK((user_id IS NULL) <> (name IS NULL))
);
--> statement-breakpoint
CREATE INDEX `visit_people_visit_idx` ON `visit_people` (`visit_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`author_id` text NOT NULL,
	`visited_on` text NOT NULL,
	`conditions` text DEFAULT '{}' NOT NULL,
	`journal_md` text DEFAULT '' NOT NULL,
	`trip_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visits_location_date_idx` ON `visits` (`location_id`,`visited_on`);--> statement-breakpoint
CREATE INDEX `visits_author_idx` ON `visits` (`author_id`);--> statement-breakpoint
ALTER TABLE `locations` ADD `status_changed_at` integer;