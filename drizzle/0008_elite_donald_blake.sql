CREATE TABLE `megadesk_domain_gemini_config` (
	`config_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`gemini_token_encrypted` text NOT NULL,
	`quota_mode` enum('free','limited','hybrid') NOT NULL DEFAULT 'free',
	`quota_mensal` int NOT NULL DEFAULT 5000,
	`quota_usada_mes` int NOT NULL DEFAULT 0,
	`data_reset_quota` timestamp NOT NULL,
	`permissions_json` text NOT NULL DEFAULT ('[]'),
	`ativo` boolean NOT NULL DEFAULT false,
	`teste_conexao` boolean NOT NULL DEFAULT false,
	`ultimo_teste_em` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_gemini_config_config_id` PRIMARY KEY(`config_id`),
	CONSTRAINT `megadesk_domain_gemini_config_client_id_unique` UNIQUE(`client_id`)
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
	CONSTRAINT `idx_mdich_user_client_unique` UNIQUE(`user_id`,`client_id`)
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
CREATE INDEX `idx_mdgc_client` ON `megadesk_domain_gemini_config` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdgc_ativo` ON `megadesk_domain_gemini_config` (`ativo`);--> statement-breakpoint
CREATE INDEX `idx_mdich_client` ON `megadesk_domain_ia_conversation_history` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdich_user` ON `megadesk_domain_ia_conversation_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_client` ON `megadesk_domain_ia_conversations` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_user` ON `megadesk_domain_ia_conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mdic_created_at` ON `megadesk_domain_ia_conversations` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mdic_tipo` ON `megadesk_domain_ia_conversations` (`tipo`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `ticket_number`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `customer_id`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `customer_name`;--> statement-breakpoint
ALTER TABLE `megadesk_domain_tickets` DROP COLUMN `title`;