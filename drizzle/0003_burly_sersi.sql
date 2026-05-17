CREATE TABLE `megadesk_domain_chamado_sequence` (
	`client_id` varchar(80) NOT NULL,
	`next_chamado_number` int NOT NULL DEFAULT 1,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamado_sequence_client_id` PRIMARY KEY(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_chamados` (
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`chamado_number` int NOT NULL,
	`customer_id` varchar(80) NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`company` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`observations` text NOT NULL DEFAULT (''),
	`status` enum('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamados_chamado_id` PRIMARY KEY(`chamado_id`),
	CONSTRAINT `megadesk_domain_chamados_chamado_number_unique` UNIQUE(`chamado_number`)
);
--> statement-breakpoint
DROP TABLE `megadesk_domain_ticket_sequence`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP INDEX `megadesk_domain_tickets_ticket_number_unique`;--> statement-breakpoint
DROP INDEX `idx_mdt_client` ON `megadesk_domain_tickets`;--> statement-breakpoint
DROP INDEX `idx_mdt_status` ON `megadesk_domain_tickets`;--> statement-breakpoint
DROP INDEX `idx_mdt_ticket_number` ON `megadesk_domain_tickets`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` MODIFY COLUMN `customer` varchar(180) NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` MODIFY COLUMN `problem` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` MODIFY COLUMN `category` varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` MODIFY COLUMN `created_label` varchar(80) NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` MODIFY COLUMN `description` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_mdcs_client` ON `megadesk_domain_chamado_sequence` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_client` ON `megadesk_domain_chamados` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_status` ON `megadesk_domain_chamados` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mdc_chamado_number` ON `megadesk_domain_chamados` (`chamado_number`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `ticket_number`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `customer_id`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `customer_name`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `title`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `observations`;