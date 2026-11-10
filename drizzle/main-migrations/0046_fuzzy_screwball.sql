CREATE TABLE `megadesk_ai_messages` (
	`id` varchar(255) NOT NULL,
	`thread_id` varchar(255) NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`tool_invocations` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_ai_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_ai_threads` (
	`id` varchar(255) NOT NULL,
	`tenant_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`title` text NOT NULL DEFAULT ('Nova Conversa'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_ai_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_ia_user_preferences` (
	`id` varchar(255) NOT NULL,
	`tenant_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`preferred_name` varchar(100),
	`honorific` varchar(50),
	`communication_style` varchar(100),
	`custom_rules_json` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_ia_user_preferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_ai_messages` ADD CONSTRAINT `megadesk_ai_messages_thread_id_megadesk_ai_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `megadesk_ai_threads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ai_messages_thread_created` ON `megadesk_ai_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_threads_tenant_user_updated` ON `megadesk_ai_threads` (`tenant_id`,`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_ia_user_preferences_tenant_user` ON `megadesk_domain_ia_user_preferences` (`tenant_id`,`user_id`);