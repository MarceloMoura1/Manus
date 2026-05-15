CREATE TABLE `megadesk_domain_chamado_history` (
	`history_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`field_changed` varchar(120) NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_chamado_history_history_id` PRIMARY KEY(`history_id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD `priority` enum('baixa','media','alta','critica') DEFAULT 'media' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD `assigned_to` varchar(80);--> statement-breakpoint
CREATE INDEX `idx_mdch_chamado` ON `megadesk_domain_chamado_history` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdch_client` ON `megadesk_domain_chamado_history` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdch_created_at` ON `megadesk_domain_chamado_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mdc_priority` ON `megadesk_domain_chamados` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_mdc_assigned_to` ON `megadesk_domain_chamados` (`assigned_to`);