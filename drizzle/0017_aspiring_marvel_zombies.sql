CREATE TABLE `megadesk_notifications` (
	`notification_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('info','success','warning','error','system') NOT NULL DEFAULT 'info',
	`is_read` boolean NOT NULL DEFAULT false,
	`action_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`read_at` timestamp,
	CONSTRAINT `megadesk_notifications_notification_id` PRIMARY KEY(`notification_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mn_client` ON `megadesk_notifications` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_user` ON `megadesk_notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_client_user` ON `megadesk_notifications` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_is_read` ON `megadesk_notifications` (`is_read`);--> statement-breakpoint
CREATE INDEX `idx_mn_created_at` ON `megadesk_notifications` (`created_at`);