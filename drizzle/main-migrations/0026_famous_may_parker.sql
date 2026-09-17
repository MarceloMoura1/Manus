CREATE TABLE `erp_product_attribute_types` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_attribute_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epat_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_epat_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_epat_tenant_name` UNIQUE(`client_id`,`name`),
	CONSTRAINT `uq_epat_tenant_slug` UNIQUE(`client_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_attribute_values` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`attribute_type_id` bigint NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_attribute_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epav_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_epav_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_epav_tenant_type_name` UNIQUE(`client_id`,`attribute_type_id`,`name`),
	CONSTRAINT `uq_epav_tenant_type_slug` UNIQUE(`client_id`,`attribute_type_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_variant_attribute_values` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`variant_id` bigint NOT NULL,
	`attribute_type_id` bigint NOT NULL,
	`attribute_value_id` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_product_variant_attribute_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epvav_variant_type` UNIQUE(`client_id`,`variant_id`,`attribute_type_id`),
	CONSTRAINT `uq_epvav_variant_value` UNIQUE(`client_id`,`variant_id`,`attribute_value_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_variants` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`sku` varchar(80) NOT NULL,
	`name` varchar(180),
	`sale_price_cents` bigint,
	`combination_hash` varchar(64),
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epv_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_epv_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_epv_tenant_sku` UNIQUE(`client_id`,`sku`),
	CONSTRAINT `uq_epv_product_combination` UNIQUE(`client_id`,`product_id`,`combination_hash`)
);
--> statement-breakpoint
ALTER TABLE `erp_product_attribute_values` ADD CONSTRAINT `fk_epav_attribute_type` FOREIGN KEY (`client_id`,`attribute_type_id`) REFERENCES `erp_product_attribute_types`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_variant_attribute_values` ADD CONSTRAINT `fk_epvav_variant` FOREIGN KEY (`client_id`,`variant_id`) REFERENCES `erp_product_variants`(`client_id`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_variant_attribute_values` ADD CONSTRAINT `fk_epvav_attribute_type` FOREIGN KEY (`client_id`,`attribute_type_id`) REFERENCES `erp_product_attribute_types`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_variant_attribute_values` ADD CONSTRAINT `fk_epvav_attribute_value` FOREIGN KEY (`client_id`,`attribute_value_id`) REFERENCES `erp_product_attribute_values`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_variants` ADD CONSTRAINT `fk_epv_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_epat_tenant_active` ON `erp_product_attribute_types` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_epav_tenant_type` ON `erp_product_attribute_values` (`client_id`,`attribute_type_id`);--> statement-breakpoint
CREATE INDEX `idx_epav_tenant_active` ON `erp_product_attribute_values` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_epvav_tenant_value` ON `erp_product_variant_attribute_values` (`client_id`,`attribute_value_id`);--> statement-breakpoint
CREATE INDEX `idx_epv_tenant_product` ON `erp_product_variants` (`client_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_epv_tenant_active` ON `erp_product_variants` (`client_id`,`active`);