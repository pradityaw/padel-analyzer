CREATE TABLE IF NOT EXISTS `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sessions_token_unique` ON `sessions` (`token`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `magic_link_challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`analysis_id` integer,
	`rating` integer NOT NULL,
	`comment` text,
	`tag` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `analyses` ADD `user_id` integer;
--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `user_id` integer;
--> statement-breakpoint
ALTER TABLE `annotations` ADD `user_id` integer;
--> statement-breakpoint
ALTER TABLE `pro_comparisons` ADD `user_id` integer;
