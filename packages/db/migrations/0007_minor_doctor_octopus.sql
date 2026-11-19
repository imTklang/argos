CREATE TABLE `locks` (
	`name` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `closed_at` integer;--> statement-breakpoint
-- Overlapping scans could score a job twice; keep the first score.
DELETE FROM `job_scores` WHERE `id` NOT IN (SELECT min(`id`) FROM `job_scores` GROUP BY `job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_scores_job_id` ON `job_scores` (`job_id`);