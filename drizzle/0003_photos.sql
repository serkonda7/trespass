CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`uploader_id` text NOT NULL,
	`location_id` text,
	`visit_id` text,
	`taken_at` integer,
	`gps_lat` real,
	`gps_lon` real,
	`exif` text DEFAULT '{}' NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`caption` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`original_name` text,
	`suggested_location_id` text,
	`suggested_visit_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`suggested_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`suggested_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "photos_status" CHECK(status IN ('processing','ready','failed'))
);
--> statement-breakpoint
CREATE INDEX `photos_location_idx` ON `photos` (`location_id`);--> statement-breakpoint
CREATE INDEX `photos_visit_idx` ON `photos` (`visit_id`);--> statement-breakpoint
CREATE INDEX `photos_uploader_idx` ON `photos` (`uploader_id`);--> statement-breakpoint
CREATE INDEX `photos_sha256_idx` ON `photos` (`sha256`);