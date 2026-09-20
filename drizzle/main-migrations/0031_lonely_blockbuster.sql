CREATE TABLE `erp_inventory_item_balances` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`inventory_item_id` bigint NOT NULL,
	`quantity` decimal(18,3) NOT NULL DEFAULT '0.000',
	`version` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_inventory_item_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_eiib_tenant_item` UNIQUE(`client_id`,`inventory_item_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_inventory_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`variant_id` bigint,
	`kind` enum('simple','variant','legacy_unallocated') NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`minimum_stock` decimal(18,3),
	`legacy_reason` varchar(120),
	`legacy_cost_snapshot_cents` bigint,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`simple_product_id` bigint GENERATED ALWAYS AS (CASE WHEN `kind` = 'simple' THEN `product_id` ELSE NULL END) VIRTUAL,
	`variant_item_id` bigint GENERATED ALWAYS AS (CASE WHEN `kind` = 'variant' THEN `variant_id` ELSE NULL END) VIRTUAL,
	`legacy_product_id` bigint GENERATED ALWAYS AS (CASE WHEN `kind` = 'legacy_unallocated' THEN `product_id` ELSE NULL END) VIRTUAL,
	CONSTRAINT `erp_inventory_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_eii_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_eii_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_eii_simple_product` UNIQUE(`client_id`,`simple_product_id`),
	CONSTRAINT `uq_eii_variant` UNIQUE(`client_id`,`variant_item_id`),
	CONSTRAINT `uq_eii_legacy_product` UNIQUE(`client_id`,`legacy_product_id`),
	CONSTRAINT `ck_eii_kind_variant` CHECK(((`erp_inventory_items`.`kind` = 'variant' AND `erp_inventory_items`.`variant_id` IS NOT NULL) OR (`erp_inventory_items`.`kind` IN ('simple', 'legacy_unallocated') AND `erp_inventory_items`.`variant_id` IS NULL))),
	CONSTRAINT `ck_eii_legacy_metadata` CHECK(((`erp_inventory_items`.`kind` = 'legacy_unallocated' AND `erp_inventory_items`.`legacy_reason` IS NOT NULL) OR (`erp_inventory_items`.`kind` <> 'legacy_unallocated' AND `erp_inventory_items`.`legacy_reason` IS NULL AND `erp_inventory_items`.`legacy_cost_snapshot_cents` IS NULL)))
);
--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` DROP INDEX `uq_erp_purchase_items_order_product`;--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` DROP INDEX `uq_erp_sale_items_order_product`;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD `inventory_item_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD `order_item_identity` varchar(96) GENERATED ALWAYS AS (CASE WHEN `inventory_item_id` IS NULL THEN CONCAT('product:', `product_id`) ELSE CONCAT('inventory:', `inventory_item_id`) END) VIRTUAL;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipt_items` ADD `inventory_item_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillment_items` ADD `inventory_item_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD `inventory_item_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD `order_item_identity` varchar(96) GENERATED ALWAYS AS (CASE WHEN `inventory_item_id` IS NULL THEN CONCAT('product:', `product_id`) ELSE CONCAT('inventory:', `inventory_item_id`) END) VIRTUAL;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD `inventory_item_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD `inventory_previous_balance` decimal(18,3);--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD `inventory_resulting_balance` decimal(18,3);--> statement-breakpoint
ALTER TABLE `erp_product_variants` ADD CONSTRAINT `uq_epv_tenant_product_id` UNIQUE(`client_id`,`product_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD CONSTRAINT `uq_erp_purchase_items_order_identity` UNIQUE(`purchase_order_id`,`order_item_identity`);--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD CONSTRAINT `uq_erp_sale_items_order_identity` UNIQUE(`sale_order_id`,`order_item_identity`);--> statement-breakpoint
ALTER TABLE `erp_inventory_item_balances` ADD CONSTRAINT `fk_eiib_inventory_item` FOREIGN KEY (`client_id`,`inventory_item_id`) REFERENCES `erp_inventory_items`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_inventory_items` ADD CONSTRAINT `fk_eii_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_inventory_items` ADD CONSTRAINT `fk_eii_variant_product` FOREIGN KEY (`client_id`,`product_id`,`variant_id`) REFERENCES `erp_product_variants`(`client_id`,`product_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_eiib_tenant` ON `erp_inventory_item_balances` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_eii_tenant_product` ON `erp_inventory_items` (`client_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_eii_tenant_active` ON `erp_inventory_items` (`client_id`,`active`);--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `fk_erp_stock_movement_inventory_item` FOREIGN KEY (`client_id`,`inventory_item_id`) REFERENCES `erp_inventory_items`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_items_inventory_item` ON `erp_purchase_order_items` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_receipt_items_inventory_item` ON `erp_purchase_order_receipt_items` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_fulfillment_item_inventory_item` ON `erp_sale_order_fulfillment_items` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_items_inventory_item` ON `erp_sale_order_items` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_stock_movement_tenant_item_date` ON `erp_stock_movements` (`client_id`,`inventory_item_id`,`created_at`);