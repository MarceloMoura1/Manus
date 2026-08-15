CREATE TABLE `megadesk_domain_conversations_messages` (
	`message_id` varchar(100) NOT NULL,
	`conversation_id` varchar(80) NOT NULL,
	`sender` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`status` varchar(40) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_conversations_messages_message_id` PRIMARY KEY(`message_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_timeline` (
	`timeline_id` varchar(80) NOT NULL,
	`crm_client_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`entry_type` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`author` varchar(180) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_crm_timeline_timeline_id` PRIMARY KEY(`timeline_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_evolution_sessions` (
	`client_id` varchar(80) NOT NULL,
	`instance_name` varchar(120) NOT NULL,
	`status` enum('disconnected','connecting','connected') NOT NULL DEFAULT 'disconnected',
	`phone_number` varchar(30),
	`connected_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_evolution_sessions_client_id` PRIMARY KEY(`client_id`),
	CONSTRAINT `uq_evo_instance` UNIQUE(`instance_name`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_ia_conversation_history` (
	`history_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`messages_json` text NOT NULL,
	`context_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_ia_conversation_history_history_id` PRIMARY KEY(`history_id`),
	CONSTRAINT `uq_mdich_user_client` UNIQUE(`user_id`,`client_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_ia_conversations` (
	`conversation_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`user_message` text NOT NULL,
	`ia_response` text NOT NULL,
	`tokens_used` int NOT NULL DEFAULT 0,
	`tipo` enum('consulta','relatorio','acao','analise') NOT NULL DEFAULT 'consulta',
	`status` enum('sucesso','erro','pendente') NOT NULL DEFAULT 'sucesso',
	`error_message` text,
	`metadata_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_ia_conversations_conversation_id` PRIMARY KEY(`conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_ia_token_usage` (
	`id` varchar(100) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_email` varchar(255) NOT NULL,
	`conversation_id` varchar(100) NOT NULL,
	`prompt_tokens` int NOT NULL DEFAULT 0,
	`completion_tokens` int NOT NULL DEFAULT 0,
	`total_tokens` int NOT NULL DEFAULT 0,
	`model` varchar(120) NOT NULL,
	`function_calls_count` int NOT NULL DEFAULT 0,
	`created_at` bigint NOT NULL,
	CONSTRAINT `megadesk_ia_token_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
	CONSTRAINT `uq_mts_client_name` UNIQUE(`client_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_clients` MODIFY COLUMN `status` enum('provisioning','active','setup','failed','paused') NOT NULL DEFAULT 'provisioning';--> statement-breakpoint
ALTER TABLE `megadesk_domain_clients` ADD CONSTRAINT `uq_mdc_company_email` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_clients` ADD CONSTRAINT `uq_mdc_company_document` UNIQUE(`cnpj`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_customers` ADD CONSTRAINT `uq_mdc_tenant_phone` UNIQUE(`clientId`,`phone`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_customers` ADD CONSTRAINT `uq_mdc_tenant_email` UNIQUE(`clientId`,`email`);--> statement-breakpoint
CREATE INDEX `idx_mdcm_conversation` ON `megadesk_domain_conversations_messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_mct_tenant_client` ON `megadesk_crm_timeline` (`client_id`,`crm_client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdich_client` ON `megadesk_domain_ia_conversation_history` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdich_user` ON `megadesk_domain_ia_conversation_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_client` ON `megadesk_domain_ia_conversations` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_user` ON `megadesk_domain_ia_conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_created_at` ON `megadesk_domain_ia_conversations` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mitu_client_created` ON `megadesk_ia_token_usage` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mitu_client_user` ON `megadesk_ia_token_usage` (`client_id`,`user_email`);--> statement-breakpoint
CREATE INDEX `idx_mts_client` ON `megadesk_ticket_statuses` (`client_id`);