CREATE TABLE `megadesk_domain_chamado_activities` (
	`activity_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`attendant` varchar(180) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamado_activities_activity_id` PRIMARY KEY(`activity_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_chamado_collaborators` (
	`collaborator_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`user_name` varchar(180) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_chamado_collaborators_collaborator_id` PRIMARY KEY(`collaborator_id`),
	CONSTRAINT `idx_mdcc_chamado_user_unique` UNIQUE(`chamado_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` DROP INDEX `megadesk_domain_chamados_chamado_number_unique`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD CONSTRAINT `idx_mdc_client_chamado_number_unique` UNIQUE(`client_id`,`chamado_number`);--> statement-breakpoint
CREATE INDEX `idx_mdca_chamado` ON `megadesk_domain_chamado_activities` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_client` ON `megadesk_domain_chamado_activities` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_created_at` ON `megadesk_domain_chamado_activities` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mdcc_chamado` ON `megadesk_domain_chamado_collaborators` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdcc_client` ON `megadesk_domain_chamado_collaborators` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdcc_user` ON `megadesk_domain_chamado_collaborators` (`user_id`);