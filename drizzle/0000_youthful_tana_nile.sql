CREATE TABLE `megaadmin_credentials` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'Administrador',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megaadmin_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `megaadmin_credentials_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_conversations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` int NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`status` enum('open','waiting','resolved') NOT NULL DEFAULT 'open',
	`channel` varchar(40) NOT NULL DEFAULT 'whatsapp',
	`last_message` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_audit_logs` (
	`audit_id` varchar(100) NOT NULL,
	`platform` enum('MegaAdmin','MegaDesk') NOT NULL,
	`action` varchar(255) NOT NULL,
	`client_id` varchar(80),
	`success` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_audit_logs_audit_id` PRIMARY KEY(`audit_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_bot_scripts` (
	`script_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`initial_message` text NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_bot_scripts_script_id` PRIMARY KEY(`script_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_client_users` (
	`user_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` enum('admin','manager','agent','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('active','blocked') NOT NULL DEFAULT 'blocked',
	`permissions_json` text NOT NULL,
	`password_hash` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_client_users_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_clients` (
	`client_id` varchar(80) NOT NULL,
	`internal_id` varchar(80) NOT NULL,
	`tenant_database_name` varchar(120) NOT NULL,
	`company` varchar(255) NOT NULL,
	`contact` varchar(180) NOT NULL,
	`email` varchar(255) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL,
	`cnpj` varchar(20) NOT NULL DEFAULT '',
	`plan` varchar(120) NOT NULL,
	`max_users` int NOT NULL DEFAULT 5,
	`status_type` enum('active','test') NOT NULL DEFAULT 'test',
	`status` enum('active','setup','paused') NOT NULL DEFAULT 'setup',
	`access_released` boolean NOT NULL DEFAULT false,
	`api_token` varchar(255) NOT NULL,
	`modules_json` text NOT NULL,
	`integrations_json` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_clients_client_id` PRIMARY KEY(`client_id`),
	CONSTRAINT `megadesk_domain_clients_tenant_database_name_unique` UNIQUE(`tenant_database_name`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_conversations` (
	`conversation_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`company` varchar(255) NOT NULL,
	`status` enum('open','bot','closed') NOT NULL DEFAULT 'open',
	`last_message` text NOT NULL,
	`time_label` varchar(80) NOT NULL,
	`messages_json` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_conversations_conversation_id` PRIMARY KEY(`conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_customers` (
	`customer_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`company` varchar(255) NOT NULL,
	`email` varchar(255),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_customers_customer_id` PRIMARY KEY(`customer_id`),
	CONSTRAINT `megadesk_domain_customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_metrics` (
	`metric_id` serial AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`metric_type` varchar(80) NOT NULL,
	`amount` int NOT NULL DEFAULT 1,
	`source` varchar(80) NOT NULL DEFAULT 'system',
	`metadata_json` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_metrics_metric_id` PRIMARY KEY(`metric_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_operational_records` (
	`record_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`tenant_database_name` varchar(120) NOT NULL,
	`record_type` enum('conversation','ticket','tracking','erp') NOT NULL,
	`owner_phone` varchar(40) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(80) NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_operational_records_record_id` PRIMARY KEY(`record_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_tickets` (
	`ticket_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company` varchar(255) NOT NULL,
	`customer` varchar(180) NOT NULL,
	`problem` varchar(255) NOT NULL,
	`category` varchar(120) NOT NULL,
	`status` enum('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
	`created_label` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_tickets_ticket_id` PRIMARY KEY(`ticket_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_tenants` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company_name` varchar(255) NOT NULL,
	`api_token_hint` varchar(40) NOT NULL,
	`status` enum('active','pending','paused') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `megadesk_tenants_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_tickets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` int NOT NULL,
	`ticket_code` varchar(40) NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`category` enum('venda','suporte','financeiro','reclamacao','duvida','agendamento','pos_venda') NOT NULL,
	`status` enum('aberto','em_progresso','aguardando_cliente','resolvido') NOT NULL DEFAULT 'aberto',
	`summary` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `megadesk_tickets_ticket_code_unique` UNIQUE(`ticket_code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`open_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'Usuário MegaDesk',
	`email` varchar(255),
	`login_method` varchar(64),
	`role` enum('admin','user') NOT NULL DEFAULT 'user',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`last_signed_in` timestamp,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_open_id_unique` UNIQUE(`open_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mdbs_client` ON `megadesk_domain_bot_scripts` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_client` ON `megadesk_domain_customers` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_phone` ON `megadesk_domain_customers` (`phone`);