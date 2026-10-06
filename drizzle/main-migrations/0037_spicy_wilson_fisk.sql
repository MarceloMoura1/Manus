CREATE TABLE `erp_sale_order_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`sale_order_id` bigint NOT NULL,
	`event_type` enum('created','updated','confirmed','stage_transition','cancelled','address_corrected','payment_registered') NOT NULL,
	`from_stage` enum('created','confirmed','separation','shipped','received','completed'),
	`to_stage` enum('created','confirmed','separation','shipped','received','completed'),
	`reason` varchar(500),
	`before_json` text,
	`after_json` text,
	`idempotency_key` varchar(100),
	`payload_hash` varchar(64),
	`changed_by` varchar(80) NOT NULL,
	`changed_by_name_snapshot` varchar(180),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_sale_order_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_events_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_sale_events_tenant_key` UNIQUE(`client_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `erp_sale_order_items` ADD `discount_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `current_stage` enum('created','confirmed','separation','shipped','received','completed');--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `seller_name_snapshot` varchar(180);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `shipping_address_snapshot` text;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `billing_address_snapshot` text;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `discount_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `freight_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `payment_method_snapshot` varchar(80);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `confirmation_idempotency_key` varchar(100);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `confirmation_payload_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `uq_erp_sale_orders_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `uq_erp_sale_orders_tenant_confirmation_key` UNIQUE(`client_id`,`confirmation_idempotency_key`);--> statement-breakpoint
ALTER TABLE `erp_sale_order_events` ADD CONSTRAINT `fk_erp_sale_events_order` FOREIGN KEY (`client_id`,`sale_order_id`) REFERENCES `erp_sale_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_sale_events_order_date` ON `erp_sale_order_events` (`client_id`,`sale_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_orders_tenant_stage_date` ON `erp_sale_orders` (`client_id`,`current_stage`,`created_at`);