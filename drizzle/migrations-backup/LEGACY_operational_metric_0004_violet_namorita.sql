CREATE TABLE `operational_metric_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`metricType` enum('message','ticket_opened','ticket_closed','whatsapp_connected','whatsapp_disconnected','server_operational','server_degraded','server_offline') NOT NULL,
	`amount` int NOT NULL DEFAULT 1,
	`source` varchar(120) NOT NULL DEFAULT 'internal',
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operational_metric_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_clients` MODIFY COLUMN `accessReleased` tinyint NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` MODIFY COLUMN `accessReleased` tinyint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `megadesk_clients` MODIFY COLUMN `aiEnabled` tinyint NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiBaseUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiTokenEncrypted` text;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiTokenLast4` varchar(12);--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiLastTestedAt` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiLastError` text;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `metricsUpdatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `operational_metric_events` ADD CONSTRAINT `operational_metric_events_clientId_megadesk_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `megadesk_clients`(`id`) ON DELETE cascade ON UPDATE no action;