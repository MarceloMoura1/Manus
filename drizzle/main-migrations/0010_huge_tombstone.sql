CREATE TABLE `erp_fiscal_document_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`fiscal_document_id` bigint NOT NULL,
	`from_status` enum('draft','ready_for_integration','cancelled'),
	`to_status` enum('draft','ready_for_integration','cancelled') NOT NULL,
	`reason` varchar(500),
	`changed_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_fiscal_document_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_document_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`fiscal_document_id` bigint NOT NULL,
	`product_public_id` varchar(36),
	`product_name_snapshot` varchar(180) NOT NULL,
	`sku_snapshot` varchar(80),
	`quantity_millis` bigint NOT NULL,
	`unit_amount_cents` bigint NOT NULL,
	`line_total_cents` bigint NOT NULL,
	`fiscal_profile_snapshot` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_fiscal_document_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fiscal_items_document_public` UNIQUE(`fiscal_document_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_document_sequences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`year` int NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `erp_fiscal_document_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fiscal_sequence_tenant_year` UNIQUE(`client_id`,`year`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_documents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`internal_number` varchar(32) NOT NULL,
	`type` enum('sale','purchase','manual') NOT NULL,
	`status` enum('draft','ready_for_integration','cancelled') NOT NULL DEFAULT 'draft',
	`internal_issue_date` date NOT NULL,
	`source_public_id` varchar(36),
	`party_name_snapshot` varchar(255) NOT NULL,
	`party_document_snapshot` varchar(30),
	`total_cents` bigint NOT NULL,
	`internal_notes` text,
	`cancelled_at` timestamp,
	`cancelled_by` varchar(80),
	`cancellation_reason` varchar(500),
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_fiscal_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fiscal_documents_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fiscal_documents_tenant_number` UNIQUE(`client_id`,`internal_number`),
	CONSTRAINT `uq_erp_fiscal_documents_tenant_source` UNIQUE(`client_id`,`type`,`source_public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_operations` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`idempotency_key` varchar(100) NOT NULL,
	`operation` enum('create_source','create_manual','ready') NOT NULL,
	`fiscal_document_id` bigint NOT NULL,
	`payload_hash` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_fiscal_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fiscal_operations_tenant_key` UNIQUE(`client_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_settings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`tax_regime` enum('mei','simples_nacional','lucro_presumido','lucro_real','other') NOT NULL,
	`taxpayer_indicator` enum('taxpayer','exempt','non_taxpayer') NOT NULL,
	`state_registration` varchar(30),
	`municipal_registration` varchar(30),
	`main_cnae` varchar(10),
	`ibge_city_code` varchar(7),
	`environment` enum('homologation','production') NOT NULL DEFAULT 'homologation',
	`provider` enum('none') NOT NULL DEFAULT 'none',
	`status` enum('incomplete','ready_for_integration') NOT NULL DEFAULT 'incomplete',
	`updated_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_fiscal_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fiscal_settings_tenant` UNIQUE(`client_id`),
	CONSTRAINT `uq_erp_fiscal_settings_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_fiscal_settings_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`settings_id` bigint NOT NULL,
	`operation` enum('created','updated') NOT NULL,
	`status` enum('incomplete','ready_for_integration') NOT NULL,
	`changed_fields` text NOT NULL,
	`changed_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_fiscal_settings_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_fiscal_profiles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`ncm` varchar(8),
	`cest` varchar(7),
	`default_outbound_cfop` varchar(4),
	`default_inbound_cfop` varchar(4),
	`goods_origin` varchar(2),
	`fiscal_unit` varchar(12) NOT NULL,
	`gtin` varchar(14),
	`service_code` varchar(20),
	`operation_nature` varchar(120),
	`internal_notes` text,
	`completeness` enum('incomplete','complete') NOT NULL DEFAULT 'incomplete',
	`updated_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_fiscal_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_product_fiscal_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_product_fiscal_product` UNIQUE(`product_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_fiscal_document_history` ADD CONSTRAINT `fk_erp_fiscal_history_document` FOREIGN KEY (`fiscal_document_id`) REFERENCES `erp_fiscal_documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_fiscal_document_items` ADD CONSTRAINT `fk_erp_fiscal_items_document` FOREIGN KEY (`fiscal_document_id`) REFERENCES `erp_fiscal_documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_fiscal_operations` ADD CONSTRAINT `fk_erp_fiscal_operations_document` FOREIGN KEY (`fiscal_document_id`) REFERENCES `erp_fiscal_documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_fiscal_settings_history` ADD CONSTRAINT `fk_erp_fiscal_settings_history_settings` FOREIGN KEY (`settings_id`) REFERENCES `erp_fiscal_settings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_fiscal_profiles` ADD CONSTRAINT `fk_erp_product_fiscal_product` FOREIGN KEY (`product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_fiscal_history_tenant_document_date` ON `erp_fiscal_document_history` (`client_id`,`fiscal_document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_fiscal_items_tenant_document` ON `erp_fiscal_document_items` (`client_id`,`fiscal_document_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_fiscal_documents_tenant_status_date` ON `erp_fiscal_documents` (`client_id`,`status`,`internal_issue_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_fiscal_settings_history_tenant_date` ON `erp_fiscal_settings_history` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_product_fiscal_tenant_complete` ON `erp_product_fiscal_profiles` (`client_id`,`completeness`);