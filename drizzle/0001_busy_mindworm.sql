ALTER TABLE `analyses` ADD `video_storage_key` text;--> statement-breakpoint
ALTER TABLE `analyses` ADD `skill_label` text;--> statement-breakpoint
ALTER TABLE `analyses` ADD `skill_confidence` real;--> statement-breakpoint
ALTER TABLE `analyses` ADD `quality_score` real;--> statement-breakpoint
ALTER TABLE `annotations` ADD `reference_tier` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `annotations` ADD `quality_band` text;--> statement-breakpoint
ALTER TABLE `annotations` ADD `source_type` text;--> statement-breakpoint
ALTER TABLE `annotations` ADD `source_url` text;
--> statement-breakpoint
UPDATE `annotations`
SET
	`reference_tier` = CASE
		WHEN `is_pro_reference` = 1 THEN 'pro'
		ELSE 'none'
	END,
	`quality_band` = CASE
		WHEN `is_pro_reference` = 1 AND `quality_band` IS NULL THEN 'pro'
		ELSE `quality_band`
	END;
--> statement-breakpoint
ALTER TABLE `pro_comparisons` ADD `reference_tier` text DEFAULT 'pro' NOT NULL;--> statement-breakpoint
ALTER TABLE `pro_benchmarks` ADD `reference_tier` text DEFAULT 'pro' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pro_benchmarks_shot_type_reference_tier_unique` ON `pro_benchmarks` (`shot_type`,`reference_tier`);