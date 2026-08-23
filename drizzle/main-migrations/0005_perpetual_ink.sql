CREATE TABLE `erp_products` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`sku` varchar(80) NOT NULL,
	`barcode` varchar(80),
	`description` text,
	`category` varchar(120),
	`unit` enum('unit','kg','liter','meter') NOT NULL,
	`cost_price_cents` bigint NOT NULL DEFAULT 0,
	`sale_price_cents` bigint NOT NULL DEFAULT 0,
	`minimum_stock` decimal(18,3) NOT NULL DEFAULT '0.000',
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_products_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_products_tenant_sku` UNIQUE(`client_id`,`sku`),
	CONSTRAINT `uq_erp_products_tenant_barcode` UNIQUE(`client_id`,`barcode`)
);
--> statement-breakpoint
CREATE TABLE `erp_stock_balances` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`quantity` decimal(18,3) NOT NULL DEFAULT '0.000',
	`version` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_stock_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_stock_balance_tenant_product` UNIQUE(`client_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_stock_movements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`type` enum('initial','manual_in','manual_out','adjustment_in','adjustment_out','reversal') NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`quantity` decimal(18,3) NOT NULL,
	`previous_balance` decimal(18,3) NOT NULL,
	`resulting_balance` decimal(18,3) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`reference_type` enum('manual','purchase','sale','purchase_reversal','sale_reversal','movement'),
	`reference_id` varchar(80),
	`idempotency_key` varchar(100) NOT NULL,
	`payload_hash` varchar(64) NOT NULL,
	`reversal_of` bigint,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_stock_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_stock_movement_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_stock_movement_tenant_idempotency` UNIQUE(`client_id`,`idempotency_key`),
	CONSTRAINT `uq_erp_stock_movement_tenant_reversal` UNIQUE(`client_id`,`reversal_of`)
);
--> statement-breakpoint
CREATE INDEX `idx_erp_products_tenant_name` ON `erp_products` (`client_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_erp_products_tenant_active` ON `erp_products` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_erp_stock_balance_tenant` ON `erp_stock_balances` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_stock_movement_tenant_product_date` ON `erp_stock_movements` (`client_id`,`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_stock_movement_tenant_date` ON `erp_stock_movements` (`client_id`,`created_at`);