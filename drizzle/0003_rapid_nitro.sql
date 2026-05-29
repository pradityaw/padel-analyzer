CREATE TABLE `game_results` (
	`code` text PRIMARY KEY NOT NULL,
	`winner_name` text,
	`results_json` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`ended_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`host_name` text,
	`created_at` text NOT NULL,
	`ended_at` text
);
