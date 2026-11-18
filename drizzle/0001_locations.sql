CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'circle' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_key_unique` ON `categories` (`key`);--> statement-breakpoint
CREATE TABLE `location_grants` (
	`location_id` text NOT NULL,
	`principal_kind` text NOT NULL,
	`principal_id` text NOT NULL,
	`level` text NOT NULL,
	PRIMARY KEY(`location_id`, `principal_kind`, `principal_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "location_grants_level" CHECK(level IN ('view','contribute','precise','edit','manage'))
);
--> statement-breakpoint
CREATE INDEX `location_grants_principal_idx` ON `location_grants` (`principal_kind`,`principal_id`);--> statement-breakpoint
CREATE TABLE `location_tags` (
	`location_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`location_id`, `tag_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_sort` text NOT NULL,
	`description` text,
	`category_id` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`pub_lat` real NOT NULL,
	`pub_lon` real NOT NULL,
	`fuzz_radius_m` integer DEFAULT 1500 NOT NULL,
	`geom_area` text,
	`parking` text,
	`access_notes` text,
	`danger_notes` text,
	`country` text,
	`admin_area` text,
	`tz` text NOT NULL,
	`built_year` integer,
	`abandoned_year` integer,
	`cover_photo_id` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`friends_level` text DEFAULT 'view' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "locations_status" CHECK(status IN ('idea','researched','planned','sealed','redeveloped','demolished')),
	CONSTRAINT "locations_visibility" CHECK(visibility IN ('private','friends')),
	CONSTRAINT "locations_friends_level" CHECK(friends_level IN ('view','contribute','precise'))
);
--> statement-breakpoint
CREATE INDEX `locations_lat_lon_idx` ON `locations` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `locations_pub_lat_lon_idx` ON `locations` (`pub_lat`,`pub_lon`);--> statement-breakpoint
CREATE INDEX `locations_owner_idx` ON `locations` (`owner_id`);--> statement-breakpoint
CREATE INDEX `locations_category_idx` ON `locations` (`category_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);