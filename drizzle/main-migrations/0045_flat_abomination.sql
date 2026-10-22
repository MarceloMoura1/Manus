CREATE TABLE `megadesk_admin_hermes_messages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`admin_user_id` varchar(100) NOT NULL,
	`role` varchar(20) NOT NULL,
	`content` text NOT NULL,
	`metadata_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_admin_hermes_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_admin_hermes_messages_user_created` ON `megadesk_admin_hermes_messages` (`admin_user_id`,`created_at`);