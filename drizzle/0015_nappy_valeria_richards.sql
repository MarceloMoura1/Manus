CREATE TABLE `megadesk_ticket_statuses` (
	`status_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`color` varchar(7) NOT NULL DEFAULT '#3b82f6',
	`order` int NOT NULL DEFAULT 0,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_ticket_statuses_status_id` PRIMARY KEY(`status_id`),
	CONSTRAINT `idx_mts_client_name_unique` UNIQUE(`client_id`,`name`)
);
--> statement-breakpoint
CREATE INDEX `idx_mts_client` ON `megadesk_ticket_statuses` (`client_id`);