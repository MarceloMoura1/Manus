CREATE TABLE `megadesk_crm_quote_templates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`name` varchar(150) NOT NULL,
	`niche` varchar(50) DEFAULT 'automotive',
	`background_image_url` text,
	`layout_config` json,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_quote_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `document_custom_name` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `service_metadata` json;--> statement-breakpoint
CREATE INDEX `idx_crm_quote_templates_tenant_public` ON `megadesk_crm_quote_templates` (`client_id`,`public_id`);