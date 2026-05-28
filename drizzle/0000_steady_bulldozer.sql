CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_file_name` text NOT NULL,
	`thumbnail_path` text,
	`created_at` text NOT NULL,
	`overall_score` real NOT NULL,
	`dominant_side` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`frame_count` integer NOT NULL,
	`sample_fps` real NOT NULL,
	`phases_json` text NOT NULL,
	`landmarks_json` text NOT NULL,
	`shot_type` text,
	`shot_confidence` real
);
--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`shot_type` text NOT NULL,
	`is_pro_reference` integer DEFAULT false NOT NULL,
	`annotated_at` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `pro_benchmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shot_type` text NOT NULL,
	`sample_count` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pro_comparisons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_analysis_id` integer NOT NULL,
	`pro_analysis_id` integer,
	`shot_type` text NOT NULL,
	`gap_analysis_json` text NOT NULL,
	`created_at` text NOT NULL,
	`notes` text
);
