CREATE TABLE `megadesk_crm_activities` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`opportunity_id` bigint,
	`crm_client_id` varchar(80),
	`type` enum('task','call','meeting','followup','note') NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`due_at` timestamp,
	`completed_at` timestamp,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`assigned_to` varchar(180) NOT NULL DEFAULT '',
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mca_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mca_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `ck_mca_entity_link` CHECK(`megadesk_crm_activities`.`opportunity_id` IS NOT NULL OR `megadesk_crm_activities`.`crm_client_id` IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_opportunities` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`pipeline_id` bigint NOT NULL,
	`stage_id` bigint NOT NULL,
	`crm_client_id` varchar(80),
	`title` varchar(255) NOT NULL,
	`value_cents` bigint NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`expected_close_date` date,
	`status` enum('open','won','lost') NOT NULL DEFAULT 'open',
	`loss_reason` varchar(255),
	`internal_responsible` varchar(180) NOT NULL DEFAULT '',
	`observations` text,
	`won_at` timestamp,
	`lost_at` timestamp,
	`closed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_opportunities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mco_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mco_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `ck_mco_value_cents` CHECK(`megadesk_crm_opportunities`.`value_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_opportunity_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`opportunity_id` bigint NOT NULL,
	`from_stage_id` bigint,
	`to_stage_id` bigint NOT NULL,
	`from_value_cents` bigint,
	`to_value_cents` bigint NOT NULL,
	`author` varchar(180) NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_crm_opportunity_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcoh_tenant_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_pipelines` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`default_marker` tinyint GENERATED ALWAYS AS (CASE WHEN `is_default` = 1 THEN 1 ELSE NULL END) VIRTUAL,
	`display_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_pipelines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcp_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mcp_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_mcp_tenant_default` UNIQUE(`client_id`,`default_marker`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_stages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`pipeline_id` bigint NOT NULL,
	`name` varchar(120) NOT NULL,
	`display_order` int NOT NULL DEFAULT 0,
	`probability_pct` int NOT NULL DEFAULT 0,
	`color` varchar(20) NOT NULL DEFAULT '#6366F1',
	`sla_days` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_stages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mcs_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mcs_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_mcs_tenant_pipeline_stage` UNIQUE(`client_id`,`pipeline_id`,`id`),
	CONSTRAINT `ck_mcs_probability_pct` CHECK(`megadesk_crm_stages`.`probability_pct` >= 0 AND `megadesk_crm_stages`.`probability_pct` <= 100)
);
--> statement-breakpoint
ALTER TABLE `megadesk_crm_activities` ADD CONSTRAINT `fk_mca_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_activities` ADD CONSTRAINT `fk_mca_opportunity` FOREIGN KEY (`client_id`,`opportunity_id`) REFERENCES `megadesk_crm_opportunities`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_activities` ADD CONSTRAINT `fk_mca_crm_client` FOREIGN KEY (`client_id`,`crm_client_id`) REFERENCES `megadesk_crm_clients`(`client_id`,`crm_client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunities` ADD CONSTRAINT `fk_mco_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunities` ADD CONSTRAINT `fk_mco_pipeline` FOREIGN KEY (`client_id`,`pipeline_id`) REFERENCES `megadesk_crm_pipelines`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunities` ADD CONSTRAINT `fk_mco_stage` FOREIGN KEY (`client_id`,`pipeline_id`,`stage_id`) REFERENCES `megadesk_crm_stages`(`client_id`,`pipeline_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunities` ADD CONSTRAINT `fk_mco_crm_client` FOREIGN KEY (`client_id`,`crm_client_id`) REFERENCES `megadesk_crm_clients`(`client_id`,`crm_client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunity_history` ADD CONSTRAINT `fk_mcoh_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunity_history` ADD CONSTRAINT `fk_mcoh_opportunity` FOREIGN KEY (`client_id`,`opportunity_id`) REFERENCES `megadesk_crm_opportunities`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunity_history` ADD CONSTRAINT `fk_mcoh_from_stage` FOREIGN KEY (`client_id`,`from_stage_id`) REFERENCES `megadesk_crm_stages`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_opportunity_history` ADD CONSTRAINT `fk_mcoh_to_stage` FOREIGN KEY (`client_id`,`to_stage_id`) REFERENCES `megadesk_crm_stages`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_pipelines` ADD CONSTRAINT `fk_mcp_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_stages` ADD CONSTRAINT `fk_mcs_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_stages` ADD CONSTRAINT `fk_mcs_pipeline` FOREIGN KEY (`client_id`,`pipeline_id`) REFERENCES `megadesk_crm_pipelines`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_mca_tenant_opportunity` ON `megadesk_crm_activities` (`client_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_tenant_crm_client` ON `megadesk_crm_activities` (`client_id`,`crm_client_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_tenant_status_due` ON `megadesk_crm_activities` (`client_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_mca_tenant_assigned` ON `megadesk_crm_activities` (`client_id`,`assigned_to`);--> statement-breakpoint
CREATE INDEX `idx_mco_tenant_pipeline_stage` ON `megadesk_crm_opportunities` (`client_id`,`pipeline_id`,`stage_id`);--> statement-breakpoint
CREATE INDEX `idx_mco_tenant_status` ON `megadesk_crm_opportunities` (`client_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mco_tenant_customer` ON `megadesk_crm_opportunities` (`client_id`,`crm_client_id`);--> statement-breakpoint
CREATE INDEX `idx_mco_tenant_responsible` ON `megadesk_crm_opportunities` (`client_id`,`internal_responsible`);--> statement-breakpoint
CREATE INDEX `idx_mcoh_tenant_opp_date` ON `megadesk_crm_opportunity_history` (`client_id`,`opportunity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tenant_order` ON `megadesk_crm_pipelines` (`client_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tenant_active` ON `megadesk_crm_pipelines` (`client_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_mcs_tenant_pipeline_order` ON `megadesk_crm_stages` (`client_id`,`pipeline_id`,`display_order`);