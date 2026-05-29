ALTER TABLE `analyses` ADD `court_corners_json` text;
--> statement-breakpoint
ALTER TABLE `analyses` ADD `mode` text DEFAULT 'match' NOT NULL;
--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `court_corners_json` text;
--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `mode` text DEFAULT 'match' NOT NULL;
