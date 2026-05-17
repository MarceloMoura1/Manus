CREATE TABLE `operational_data_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`tenantDatabaseName` varchar(120) NOT NULL,
	`recordType` enum('tracking','erp','conversation','ticket') NOT NULL,
	`ownerPhone` varchar(32) NOT NULL,
	`ownerPhoneNormalized` varchar(32) NOT NULL,
	`ownerLogin` varchar(320),
	`externalId` varchar(160),
	`title` varchar(240) NOT NULL,
	`status` varchar(80),
	`payload` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operational_data_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `client_users` ADD `tenantDatabaseName` varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE `client_users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `client_users` ADD `phoneNormalized` varchar(32);--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `tenantDatabaseName` varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE `operational_metric_events` ADD `tenantDatabaseName` varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD CONSTRAINT `megadesk_clients_tenantDatabaseName_unique` UNIQUE(`tenantDatabaseName`);--> statement-breakpoint
ALTER TABLE `operational_data_records` ADD CONSTRAINT `operational_data_records_clientId_megadesk_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `megadesk_clients`(`id`) ON DELETE cascade ON UPDATE no action;