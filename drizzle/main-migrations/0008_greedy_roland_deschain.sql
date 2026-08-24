CREATE TABLE `erp_sale_order_fulfillment_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`fulfillment_id` bigint NOT NULL,
	`sale_order_item_id` bigint NOT NULL,
	`product_id` bigint NOT NULL,
	`quantity` decimal(18,3) NOT NULL,
	`stock_movement_id` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_sale_order_fulfillment_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_fulfillment_item_order_item` UNIQUE(`fulfillment_id`,`sale_order_item_id`),
	CONSTRAINT `uq_erp_sale_fulfillment_item_movement` UNIQUE(`stock_movement_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_sale_order_fulfillments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`sale_order_id` bigint NOT NULL,
	`idempotency_key` varchar(100) NOT NULL,
	`fulfilled_by` varchar(80) NOT NULL,
	`fulfilled_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_sale_order_fulfillments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_fulfillments_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_sale_fulfillments_tenant_idempotency` UNIQUE(`client_id`,`idempotency_key`),
	CONSTRAINT `uq_erp_sale_fulfillments_order` UNIQUE(`sale_order_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_sale_order_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`sale_order_id` bigint NOT NULL,
	`from_status` enum('draft','confirmed','fulfilled','cancelled'),
	`to_status` enum('draft','confirmed','fulfilled','cancelled') NOT NULL,
	`reason` varchar(500),
	`changed_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_sale_order_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_sale_order_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`sale_order_id` bigint NOT NULL,
	`product_id` bigint NOT NULL,
	`product_name_snapshot` varchar(180) NOT NULL,
	`sku_snapshot` varchar(80) NOT NULL,
	`quantity` decimal(18,3) NOT NULL,
	`unit_price_cents` bigint NOT NULL,
	`line_total_cents` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_sale_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_items_order_public` UNIQUE(`sale_order_id`,`public_id`),
	CONSTRAINT `uq_erp_sale_items_order_product` UNIQUE(`sale_order_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_sale_order_sequences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`year` int NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `erp_sale_order_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_sequence_tenant_year` UNIQUE(`client_id`,`year`)
);
--> statement-breakpoint
CREATE TABLE `erp_sale_orders` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`order_number` varchar(32) NOT NULL,
	`crm_client_id` varchar(80) NOT NULL,
	`customer_name_snapshot` varchar(255) NOT NULL,
	`status` enum('draft','confirmed','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`expected_date` date,
	`subtotal_cents` bigint NOT NULL DEFAULT 0,
	`total_cents` bigint NOT NULL DEFAULT 0,
	`confirmed_by` varchar(80),
	`confirmed_at` timestamp,
	`fulfilled_by` varchar(80),
	`fulfilled_at` timestamp,
	`cancelled_by` varchar(80),
	`cancelled_at` timestamp,
	`cancellation_reason` varchar(500),
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_sale_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_orders_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_sale_orders_tenant_number` UNIQUE(`client_id`,`order_number`)
);
--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `type` enum('initial','manual_in','manual_out','adjustment_in','adjustment_out','purchase_in','sale_out','reversal') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillment_items` ADD CONSTRAINT `fk_erp_sofi_fulfillment` FOREIGN KEY (`fulfillment_id`) REFERENCES `erp_sale_order_fulfillments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillment_items` ADD CONSTRAINT `fk_erp_sofi_order_item` FOREIGN KEY (`sale_order_item_id`) REFERENCES `erp_sale_order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillment_items` ADD CONSTRAINT `fk_erp_sofi_product` FOREIGN KEY (`product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillment_items` ADD CONSTRAINT `fk_erp_sofi_movement` FOREIGN KEY (`stock_movement_id`) REFERENCES `erp_stock_movements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_fulfillments` ADD CONSTRAINT `fk_erp_sof_order` FOREIGN KEY (`sale_order_id`) REFERENCES `erp_sale_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_history` ADD CONSTRAINT `fk_erp_soh_order` FOREIGN KEY (`sale_order_id`) REFERENCES `erp_sale_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD CONSTRAINT `fk_erp_soi_order` FOREIGN KEY (`sale_order_id`) REFERENCES `erp_sale_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD CONSTRAINT `fk_erp_soi_product` FOREIGN KEY (`product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `fk_erp_so_customer` FOREIGN KEY (`crm_client_id`) REFERENCES `megadesk_crm_clients`(`crm_client_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_sale_history_order_date` ON `erp_sale_order_history` (`sale_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_orders_tenant_status_date` ON `erp_sale_orders` (`client_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_orders_tenant_customer` ON `erp_sale_orders` (`client_id`,`crm_client_id`);