ALTER TABLE `jobs` ADD `title_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `duplicate_of` integer;--> statement-breakpoint
CREATE INDEX `jobs_title_key` ON `jobs` (`title_key`);