CREATE TABLE `erp_sale_document_sequences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`document_type` enum('quote','sale') NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `erp_sale_document_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_document_sequence` UNIQUE(`client_id`,`document_type`)
);
--> statement-breakpoint
ALTER TABLE `erp_sale_order_events` MODIFY COLUMN `event_type` enum('created','updated','confirmed','stage_transition','cancelled','address_corrected','payment_registered','document_added','document_removed','duplicated','quote_status_changed','quote_converted','archived','financial_adjusted') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `document_type` enum('quote','sale') DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `commercial_status` enum('draft','negotiation','approved','converted','active','completed','lost','cancelled') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `commercial_date` date;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `seller_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `charges_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `payment_terms_snapshot` varchar(500);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `source_quote_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `conversion_idempotency_key` varchar(100);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `duplicate_source_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `duplication_idempotency_key` varchar(100);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `archived_by` varchar(80);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD `archived_at` timestamp;--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `uq_erp_sale_orders_tenant_source_quote` UNIQUE(`client_id`,`source_quote_id`);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `uq_erp_sale_orders_tenant_conversion_key` UNIQUE(`client_id`,`conversion_idempotency_key`);--> statement-breakpoint
ALTER TABLE `erp_sale_orders` ADD CONSTRAINT `uq_erp_sale_orders_tenant_duplication_key` UNIQUE(`client_id`,`duplication_idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_orders_tenant_document_status` ON `erp_sale_orders` (`client_id`,`document_type`,`commercial_status`,`commercial_date`);