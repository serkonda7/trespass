CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`location_id` text,
	`visit_id` text,
	`photo_id` text,
	`parent_id` text,
	`body_md` text NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`deleted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_one_target" CHECK(((location_id IS NOT NULL) + (visit_id IS NOT NULL) + (photo_id IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE INDEX `comments_location_idx` ON `comments` (`location_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_visit_idx` ON `comments` (`visit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_photo_idx` ON `comments` (`photo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`weight_g` integer,
	`needs_charging` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "equipment_category" CHECK(category IN ('light','protection','photo','navigation','first_aid','tools','other'))
);
--> statement-breakpoint
CREATE INDEX `equipment_owner_idx` ON `equipment` (`owner_id`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`date_from` text NOT NULL,
	`date_to` text,
	`date_precision` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`candidate_id` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "history_precision" CHECK(date_precision IN ('day','month','year','decade','circa')),
	CONSTRAINT "history_status" CHECK(status IN ('draft','approved'))
);
--> statement-breakpoint
CREATE INDEX `history_location_idx` ON `history` (`location_id`,`date_from`);--> statement-breakpoint
CREATE TABLE `pack_template_items` (
	`template_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	PRIMARY KEY(`template_id`, `equipment_id`),
	FOREIGN KEY (`template_id`) REFERENCES `pack_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pack_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pack_templates_owner_idx` ON `pack_templates` (`owner_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`retrieved_on` text NOT NULL,
	`excerpt` text,
	`archived_url` text,
	`archive_status` text DEFAULT 'pending' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`history_id`) REFERENCES `history`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sources_archive_status" CHECK(archive_status IN ('pending','done','failed','skipped'))
);
--> statement-breakpoint
CREATE INDEX `sources_history_idx` ON `sources` (`history_id`);--> statement-breakpoint
CREATE TABLE `trip_checklist` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`equipment_id` text,
	`label` text NOT NULL,
	`packed` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trip_checklist_trip_idx` ON `trip_checklist` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_people` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text,
	`name` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trip_people_exactly_one" CHECK((user_id IS NULL) <> (name IS NULL))
);
--> statement-breakpoint
CREATE INDEX `trip_people_trip_idx` ON `trip_people` (`trip_id`);--> statement-breakpoint
CREATE INDEX `trip_people_user_idx` ON `trip_people` (`user_id`);--> statement-breakpoint
CREATE TABLE `trip_stops` (
	`trip_id` text NOT NULL,
	`location_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`trip_id`, `location_id`),
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_stops_location_idx` ON `trip_stops` (`location_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`notes` text DEFAULT '' NOT NULL,
	`report_md` text DEFAULT '' NOT NULL,
	`emergency_contact` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trips_status" CHECK(status IN ('planned','active','done','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `trips_owner_idx` ON `trips` (`owner_id`);--> statement-breakpoint
CREATE INDEX `trips_starts_idx` ON `trips` (`starts_on`);