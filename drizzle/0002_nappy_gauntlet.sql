CREATE TABLE `analysis_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_file_name` text NOT NULL,
	`video_storage_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`status_message` text,
	`error_message` text,
	`analysis_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
