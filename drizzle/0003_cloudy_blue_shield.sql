ALTER TABLE `client_users` ADD `lastIp` varchar(80);--> statement-breakpoint
ALTER TABLE `client_users` ADD `lastDevice` varchar(160);--> statement-breakpoint
ALTER TABLE `client_users` ADD `forceLogoutAt` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `apiStatus` enum('not_connected','connected','error') DEFAULT 'not_connected' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `accessReleased` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `connectedWhatsapps` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `openTickets` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `messagesToday` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `serverStatus` enum('operational','degraded','offline') DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `aiEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `aiModel` varchar(120) DEFAULT 'Padrão MegaDesk' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `aiMessageLimit` int DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_clients` ADD `aiTone` varchar(120) DEFAULT 'Consultivo' NOT NULL;