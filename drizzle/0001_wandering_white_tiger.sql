CREATE TABLE `client_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int,
	`name` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` text NOT NULL,
	`role` enum('admin','manager','agent','viewer') NOT NULL DEFAULT 'agent',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`permissions` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp,
	CONSTRAINT `client_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`contactName` varchar(160),
	`email` varchar(320),
	`phone` varchar(32),
	`whatsapp` varchar(32),
	`document` varchar(64),
	`plan` varchar(80) NOT NULL DEFAULT 'Profissional',
	`status` enum('active','setup','paused') NOT NULL DEFAULT 'setup',
	`botName` varchar(120),
	`initialSettings` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_clientId_megadesk_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `megadesk_clients`(`id`) ON DELETE cascade ON UPDATE no action;