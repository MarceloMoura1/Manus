CREATE TABLE `megadesk_crm_ai_settings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`is_enabled` boolean NOT NULL DEFAULT true,
	`system_prompt` text,
	`qualification_criteria` text,
	`auto_suggest_next_action` boolean NOT NULL DEFAULT true,
	`model_name` varchar(50) NOT NULL DEFAULT 'gemini-1.5-flash',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_ai_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcai_tenant` UNIQUE(`client_id`),
	CONSTRAINT `uq_mcai_tenant_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_automation_rules` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` text,
	`trigger_type` varchar(50) NOT NULL,
	`conditions` json NOT NULL,
	`actions` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`execution_count` int NOT NULL DEFAULT 0,
	`last_executed_at` timestamp,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_automation_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcar_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mcar_tenant_id` UNIQUE(`client_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_automation_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`rule_id` bigint,
	`rule_name` varchar(150) NOT NULL DEFAULT '',
	`event_type` varchar(50) NOT NULL,
	`status` enum('success','failed','partial','skipped') NOT NULL,
	`trigger_payload` json,
	`results` json NOT NULL,
	`error_message` text,
	`duration_ms` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_crm_automation_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcarun_tenant_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_webhook_sources` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`token` varchar(64) NOT NULL,
	`default_stage_id` bigint,
	`field_mappings` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`total_received` int NOT NULL DEFAULT 0,
	`last_received_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_webhook_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcws_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mcws_tenant_token` UNIQUE(`client_id`,`token`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_crm_ai_settings` ADD CONSTRAINT `fk_mcai_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_automation_rules` ADD CONSTRAINT `fk_mcar_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_automation_runs` ADD CONSTRAINT `fk_mcarun_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_webhook_sources` ADD CONSTRAINT `fk_mcws_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_mcar_tenant_trigger` ON `megadesk_crm_automation_rules` (`client_id`,`trigger_type`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_mcarun_tenant_rule` ON `megadesk_crm_automation_runs` (`client_id`,`rule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mcarun_tenant_status` ON `megadesk_crm_automation_runs` (`client_id`,`status`,`created_at`);