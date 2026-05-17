CREATE TABLE `megadesk_crm_clients` (
	`crm_client_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company_name` varchar(255) NOT NULL,
	`responsible_name` varchar(180) NOT NULL DEFAULT '',
	`cpf_cnpj` varchar(20) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL DEFAULT '',
	`whatsapp` varchar(40) NOT NULL DEFAULT '',
	`email` varchar(255) NOT NULL DEFAULT '',
	`address` varchar(255) NOT NULL DEFAULT '',
	`city` varchar(120) NOT NULL DEFAULT '',
	`state` varchar(2) NOT NULL DEFAULT '',
	`cep` varchar(10) NOT NULL DEFAULT '',
	`status` enum('lead','ativo','inativo','cancelado','inadimplente') NOT NULL DEFAULT 'lead',
	`origin` enum('whatsapp','instagram','facebook','site','indicacao','outro') NOT NULL DEFAULT 'outro',
	`internal_responsible` varchar(180) NOT NULL DEFAULT '',
	`tags` text NOT NULL DEFAULT (''),
	`observations` text NOT NULL DEFAULT (''),
	`last_interaction_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_clients_crm_client_id` PRIMARY KEY(`crm_client_id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `crm_client_id` varchar(36);--> statement-breakpoint
CREATE INDEX `idx_mcc_client` ON `megadesk_crm_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mcc_status` ON `megadesk_crm_clients` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mcc_company` ON `megadesk_crm_clients` (`company_name`);--> statement-breakpoint
CREATE INDEX `idx_mcc_phone` ON `megadesk_crm_clients` (`phone`);