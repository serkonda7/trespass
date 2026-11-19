CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`area_id` text,
	`kind` text NOT NULL,
	`location_id` text,
	`result_location_id` text,
	`lat` real,
	`lon` real,
	`name` text,
	`name_sort` text,
	`source_key` text,
	`payload` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`area_id`) REFERENCES `search_areas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "candidates_kind" CHECK(kind IN ('new_location','fact','status_change')),
	CONSTRAINT "candidates_status" CHECK(status IN ('inbox','accepted','merged','rejected')),
	CONSTRAINT "candidates_subject" CHECK(("candidates"."kind" = 'new_location') OR ("candidates"."location_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `candidates_status_idx` ON `candidates` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `candidates_source_idx` ON `candidates` (`source_key`);--> statement-breakpoint
CREATE INDEX `candidates_lat_lon_idx` ON `candidates` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `candidates_location_idx` ON `candidates` (`location_id`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`status` integer NOT NULL,
	`etag` text,
	`last_modified` text,
	`content_type` text,
	`fetched_at` integer NOT NULL,
	`body_path` text
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`area_id` text,
	`location_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`summary` text,
	`error` text,
	`cost_cents` real DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `search_areas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "research_runs_kind" CHECK(kind IN ('scan.overpass','scan.wikidata','enrich','watch')),
	CONSTRAINT "research_runs_status" CHECK(status IN ('pending','running','done','failed','budget','skipped'))
);
--> statement-breakpoint
CREATE INDEX `research_runs_created_idx` ON `research_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `research_watch` (
	`location_id` text PRIMARY KEY NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `search_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`geom` text NOT NULL,
	`lang` text DEFAULT 'de' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
