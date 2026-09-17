CREATE TABLE `erp_product_brands` (
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
	CONSTRAINT `erp_product_brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epb_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_epb_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_epb_tenant_name` UNIQUE(`client_id`,`name`),
	CONSTRAINT `uq_epb_tenant_slug` UNIQUE(`client_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_categories` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`parent_id` bigint,
	`depth` tinyint NOT NULL DEFAULT 0,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epc_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_epc_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_epc_tenant_slug` UNIQUE(`client_id`,`slug`),
	CONSTRAINT `uq_epc_tenant_name_parent` UNIQUE(`client_id`,`parent_id`,`name`),
	CONSTRAINT `chk_epc_depth` CHECK (`depth` <= 2)
);
--> statement-breakpoint
ALTER TABLE `erp_products` ADD `category_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_products` ADD `brand_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_product_categories` ADD CONSTRAINT `fk_epc_parent` FOREIGN KEY (`client_id`,`parent_id`) REFERENCES `erp_product_categories`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_epb_tenant_active` ON `erp_product_brands` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_epc_tenant_active` ON `erp_product_categories` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_epc_tenant_parent` ON `erp_product_categories` (`client_id`,`parent_id`);--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `fk_erp_products_category` FOREIGN KEY (`client_id`,`category_id`) REFERENCES `erp_product_categories`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `fk_erp_products_brand` FOREIGN KEY (`client_id`,`brand_id`) REFERENCES `erp_product_brands`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_products_category` ON `erp_products` (`client_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_products_brand` ON `erp_products` (`client_id`,`brand_id`);