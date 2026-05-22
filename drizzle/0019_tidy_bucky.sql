CREATE TABLE `baileys_failed_messages` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`conversation_id` varchar(80) NOT NULL,
	`phone` varchar(50) NOT NULL,
	`message_text` text NOT NULL,
	`error_type` varchar(50),
	`error_message` text,
	`retry_count` int NOT NULL DEFAULT 0,
	`max_retries` int NOT NULL DEFAULT 10,
	`status` enum('pending','retrying','completed','failed') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_retry_at` timestamp,
	`completed_at` timestamp,
	CONSTRAINT `baileys_failed_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` MODIFY COLUMN `crm_client_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `assigned_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `assigned_user_name` varchar(180);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `unread_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `ia_active` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `last_message_from` varchar(20);--> statement-breakpoint
CREATE INDEX `idx_bfm_client` ON `baileys_failed_messages` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_bfm_conv` ON `baileys_failed_messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_bfm_status` ON `baileys_failed_messages` (`status`);--> statement-breakpoint
CREATE INDEX `idx_bfm_created` ON `baileys_failed_messages` (`created_at`);