CREATE TABLE `erp_purchase_order_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`purchase_order_id` bigint NOT NULL,
	`from_status` enum('draft','approved','received','cancelled'),
	`to_status` enum('draft','approved','received','cancelled') NOT NULL,
	`reason` varchar(500),
	`changed_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_order_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_order_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`purchase_order_id` bigint NOT NULL,
	`product_id` bigint NOT NULL,
	`product_name_snapshot` varchar(180) NOT NULL,
	`sku_snapshot` varchar(80) NOT NULL,
	`quantity` decimal(18,3) NOT NULL,
	`unit_cost_cents` bigint NOT NULL,
	`line_total_cents` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_items_order_public` UNIQUE(`purchase_order_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_items_order_product` UNIQUE(`purchase_order_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_order_receipt_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`receipt_id` bigint NOT NULL,
	`purchase_order_item_id` bigint NOT NULL,
	`product_id` bigint NOT NULL,
	`quantity` decimal(18,3) NOT NULL,
	`stock_movement_id` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_order_receipt_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_receipt_items_receipt_order_item` UNIQUE(`receipt_id`,`purchase_order_item_id`),
	CONSTRAINT `uq_erp_purchase_receipt_items_stock_movement` UNIQUE(`stock_movement_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_order_receipts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_order_id` bigint NOT NULL,
	`idempotency_key` varchar(100) NOT NULL,
	`received_by` varchar(80) NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_order_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_receipts_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_receipts_tenant_idempotency` UNIQUE(`client_id`,`idempotency_key`),
	CONSTRAINT `uq_erp_purchase_receipts_order` UNIQUE(`purchase_order_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_order_sequences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`year` int NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `erp_purchase_order_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_sequence_tenant_year` UNIQUE(`client_id`,`year`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_orders` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`order_number` varchar(32) NOT NULL,
	`supplier_id` bigint NOT NULL,
	`supplier_name_snapshot` varchar(180) NOT NULL,
	`status` enum('draft','approved','received','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`expected_date` date,
	`subtotal_cents` bigint NOT NULL DEFAULT 0,
	`total_cents` bigint NOT NULL DEFAULT 0,
	`approved_by` varchar(80),
	`approved_at` timestamp,
	`received_by` varchar(80),
	`received_at` timestamp,
	`cancelled_by` varchar(80),
	`cancelled_at` timestamp,
	`cancellation_reason` varchar(500),
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_orders_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_orders_tenant_number` UNIQUE(`client_id`,`order_number`)
);
--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `type` enum('initial','manual_in','manual_out','adjustment_in','adjustment_out','purchase_in','reversal') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_history` ADD CONSTRAINT `fk_erp_poh_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `erp_purchase_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD CONSTRAINT `fk_erp_poi_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `erp_purchase_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD CONSTRAINT `fk_erp_poi_product` FOREIGN KEY (`product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipt_items` ADD CONSTRAINT `fk_erp_pori_receipt` FOREIGN KEY (`receipt_id`) REFERENCES `erp_purchase_order_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipt_items` ADD CONSTRAINT `fk_erp_pori_order_item` FOREIGN KEY (`purchase_order_item_id`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipt_items` ADD CONSTRAINT `fk_erp_pori_product` FOREIGN KEY (`product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipt_items` ADD CONSTRAINT `fk_erp_pori_movement` FOREIGN KEY (`stock_movement_id`) REFERENCES `erp_stock_movements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD CONSTRAINT `fk_erp_por_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `erp_purchase_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `fk_erp_po_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `erp_suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_history_order_date` ON `erp_purchase_order_history` (`purchase_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_orders_tenant_status_date` ON `erp_purchase_orders` (`client_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_orders_tenant_supplier` ON `erp_purchase_orders` (`client_id`,`supplier_id`);