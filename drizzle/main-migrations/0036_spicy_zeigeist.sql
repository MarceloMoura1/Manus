CREATE TABLE `erp_purchase_approvals` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_request_id` bigint,
	`purchase_order_id` bigint,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`requested_by` varchar(80) NOT NULL,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`decided_by` varchar(80),
	`decided_at` timestamp,
	`justification` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_approvals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_approvals_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `ck_erp_purchase_approval_entity` CHECK((`erp_purchase_approvals`.`purchase_request_id` IS NOT NULL AND `erp_purchase_approvals`.`purchase_order_id` IS NULL) OR (`erp_purchase_approvals`.`purchase_request_id` IS NULL AND `erp_purchase_approvals`.`purchase_order_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_document_links` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_request_id` bigint,
	`purchase_quote_id` bigint,
	`purchase_order_id` bigint,
	`supplier_file_id` bigint NOT NULL,
	`document_type` enum('proposal','budget','purchase_order','invoice','receipt','payment_proof','other') NOT NULL,
	`linked_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_document_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_documents_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_documents_file_entity` UNIQUE(`supplier_file_id`,`purchase_request_id`,`purchase_quote_id`,`purchase_order_id`),
	CONSTRAINT `ck_erp_purchase_document_entity` CHECK(((`erp_purchase_document_links`.`purchase_request_id` IS NOT NULL) + (`erp_purchase_document_links`.`purchase_quote_id` IS NOT NULL) + (`erp_purchase_document_links`.`purchase_order_id` IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_request_id` bigint,
	`purchase_quote_id` bigint,
	`purchase_order_id` bigint,
	`entity_type` enum('request','quote','order','receipt','financial','stock','document') NOT NULL,
	`entity_public_id` varchar(36) NOT NULL,
	`action` varchar(80) NOT NULL,
	`actor_type` enum('human','system') NOT NULL,
	`actor_user_id` varchar(80),
	`actor_name_snapshot` varchar(180),
	`actor_role` varchar(20),
	`summary` varchar(500) NOT NULL,
	`before_json` json,
	`after_json` json,
	`metadata_json` json,
	`correlation_id` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_events_tenant_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_order_installments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_order_id` bigint NOT NULL,
	`installment_number` int NOT NULL,
	`due_date` date NOT NULL,
	`amount_cents` bigint NOT NULL,
	`financial_entry_id` bigint,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_order_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_installments_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_installments_order_number` UNIQUE(`purchase_order_id`,`installment_number`),
	CONSTRAINT `uq_erp_purchase_installments_financial_entry` UNIQUE(`financial_entry_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_quote_proposal_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`proposal_id` bigint NOT NULL,
	`request_item_id` bigint NOT NULL,
	`unit_cost_cents` bigint NOT NULL,
	`discount_cents` bigint NOT NULL DEFAULT 0,
	`line_total_cents` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_purchase_quote_proposal_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_quote_proposal_item` UNIQUE(`proposal_id`,`request_item_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_quote_proposals` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`quote_id` bigint NOT NULL,
	`supplier_id` bigint NOT NULL,
	`supplier_name_snapshot` varchar(180) NOT NULL,
	`subtotal_cents` bigint NOT NULL,
	`freight_cents` bigint NOT NULL DEFAULT 0,
	`total_cents` bigint NOT NULL,
	`lead_time_days` int,
	`payment_terms` varchar(500),
	`notes` text,
	`supplier_file_id` bigint,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_quote_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_quote_proposals_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_quote_proposals_supplier` UNIQUE(`quote_id`,`supplier_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_quotes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`quote_number` varchar(32) NOT NULL,
	`purchase_request_id` bigint NOT NULL,
	`status` enum('draft','collecting','selected','cancelled') NOT NULL DEFAULT 'draft',
	`selected_proposal_id` bigint,
	`selected_by` varchar(80),
	`selected_at` timestamp,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_quotes_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_quotes_tenant_number` UNIQUE(`client_id`,`quote_number`),
	CONSTRAINT `uq_erp_purchase_quotes_request` UNIQUE(`purchase_request_id`),
	CONSTRAINT `uq_erp_purchase_quotes_tenant_id` UNIQUE(`client_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_request_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`purchase_request_id` bigint NOT NULL,
	`product_id` bigint,
	`inventory_item_id` bigint,
	`description_snapshot` varchar(180) NOT NULL,
	`sku_snapshot` varchar(80),
	`unit_snapshot` varchar(20),
	`quantity` decimal(18,3) NOT NULL,
	`estimated_unit_cost_cents` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_request_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_request_items_public` UNIQUE(`purchase_request_id`,`public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`request_number` varchar(32) NOT NULL,
	`requester_user_id` varchar(80) NOT NULL,
	`responsible_user_id` varchar(80),
	`department` varchar(120),
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`reason` text NOT NULL,
	`status` enum('draft','pending_approval','approved','rejected','cancelled') NOT NULL DEFAULT 'draft',
	`approval_requested_by` varchar(80),
	`approval_requested_at` timestamp,
	`decided_by` varchar(80),
	`decided_at` timestamp,
	`decision_reason` varchar(500),
	`cancelled_by` varchar(80),
	`cancelled_at` timestamp,
	`cancellation_reason` varchar(500),
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_purchase_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_requests_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_purchase_requests_tenant_number` UNIQUE(`client_id`,`request_number`),
	CONSTRAINT `uq_erp_purchase_requests_tenant_id` UNIQUE(`client_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchase_workflow_sequences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`entity_type` enum('request','quote') NOT NULL,
	`year` int NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	CONSTRAINT `erp_purchase_workflow_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_purchase_workflow_sequence` UNIQUE(`client_id`,`entity_type`,`year`)
);
--> statement-breakpoint
ALTER TABLE `erp_financial_entries` DROP INDEX `uq_erp_fin_entries_tenant_source`;--> statement-breakpoint
CREATE INDEX `idx_erp_fin_settlements_tenant_entry` ON `erp_financial_settlements` (`client_id`,`financial_entry_id`);--> statement-breakpoint
ALTER TABLE `erp_financial_settlements` DROP INDEX `uq_erp_fin_settlements_tenant_entry`;--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD `source_installment` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_items` ADD `discount_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD `receipt_number` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD `document_number` varchar(120);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `creation_idempotency_key` varchar(100);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `source_type` enum('direct','request','quote') DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `purchase_request_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `purchase_quote_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `responsible_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `discount_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `freight_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `other_expenses_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD `payment_terms` varchar(500);--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD CONSTRAINT `uq_erp_fin_entries_tenant_source_installment` UNIQUE(`client_id`,`source_type`,`source_public_id`,`source_installment`);--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD CONSTRAINT `uq_erp_purchase_receipts_order_number` UNIQUE(`purchase_order_id`,`receipt_number`);--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` DROP INDEX `uq_erp_purchase_receipts_order`;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `uq_erp_purchase_orders_tenant_creation_key` UNIQUE(`client_id`,`creation_idempotency_key`);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `uq_erp_purchase_orders_request` UNIQUE(`purchase_request_id`);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `uq_erp_purchase_orders_quote` UNIQUE(`purchase_quote_id`);--> statement-breakpoint
ALTER TABLE `erp_supplier_files` ADD CONSTRAINT `uq_esf_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `uq_erp_purchase_orders_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD CONSTRAINT `uq_erp_fin_entries_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_purchase_approvals` ADD CONSTRAINT `fk_erp_purchase_approval_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_approvals` ADD CONSTRAINT `fk_erp_purchase_approval_order` FOREIGN KEY (`client_id`,`purchase_order_id`) REFERENCES `erp_purchase_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_document_links` ADD CONSTRAINT `fk_erp_purchase_document_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_document_links` ADD CONSTRAINT `fk_erp_purchase_document_quote` FOREIGN KEY (`client_id`,`purchase_quote_id`) REFERENCES `erp_purchase_quotes`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_document_links` ADD CONSTRAINT `fk_erp_purchase_document_order` FOREIGN KEY (`client_id`,`purchase_order_id`) REFERENCES `erp_purchase_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_document_links` ADD CONSTRAINT `fk_erp_purchase_document_file` FOREIGN KEY (`client_id`,`supplier_file_id`) REFERENCES `erp_supplier_files`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_events` ADD CONSTRAINT `fk_erp_purchase_event_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_events` ADD CONSTRAINT `fk_erp_purchase_event_quote` FOREIGN KEY (`client_id`,`purchase_quote_id`) REFERENCES `erp_purchase_quotes`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_events` ADD CONSTRAINT `fk_erp_purchase_event_order` FOREIGN KEY (`client_id`,`purchase_order_id`) REFERENCES `erp_purchase_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_installments` ADD CONSTRAINT `fk_erp_purchase_installment_order` FOREIGN KEY (`client_id`,`purchase_order_id`) REFERENCES `erp_purchase_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_installments` ADD CONSTRAINT `fk_erp_purchase_installment_financial_entry` FOREIGN KEY (`client_id`,`financial_entry_id`) REFERENCES `erp_financial_entries`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quote_proposal_items` ADD CONSTRAINT `fk_erp_purchase_quote_proposal_item_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `erp_purchase_quote_proposals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quote_proposal_items` ADD CONSTRAINT `fk_erp_purchase_quote_proposal_item_request_item` FOREIGN KEY (`request_item_id`) REFERENCES `erp_purchase_request_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quote_proposals` ADD CONSTRAINT `fk_erp_purchase_quote_proposal_quote` FOREIGN KEY (`client_id`,`quote_id`) REFERENCES `erp_purchase_quotes`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quote_proposals` ADD CONSTRAINT `fk_erp_purchase_quote_proposal_supplier` FOREIGN KEY (`client_id`,`supplier_id`) REFERENCES `erp_suppliers`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quote_proposals` ADD CONSTRAINT `fk_erp_purchase_quote_proposal_file` FOREIGN KEY (`client_id`,`supplier_file_id`) REFERENCES `erp_supplier_files`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_quotes` ADD CONSTRAINT `fk_erp_purchase_quote_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_request_items` ADD CONSTRAINT `fk_erp_purchase_request_item_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_request_items` ADD CONSTRAINT `fk_erp_purchase_request_item_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_approvals_request_date` ON `erp_purchase_approvals` (`purchase_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_approvals_order_date` ON `erp_purchase_approvals` (`purchase_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_events_request_date` ON `erp_purchase_events` (`client_id`,`purchase_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_events_order_date` ON `erp_purchase_events` (`client_id`,`purchase_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_request_items_tenant_request` ON `erp_purchase_request_items` (`client_id`,`purchase_request_id`);--> statement-breakpoint
CREATE INDEX `idx_erp_purchase_requests_tenant_status_date` ON `erp_purchase_requests` (`client_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `fk_erp_po_supplier_tenant` FOREIGN KEY (`client_id`,`supplier_id`) REFERENCES `erp_suppliers`(`client_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_order_receipts` ADD CONSTRAINT `fk_erp_por_order_tenant` FOREIGN KEY (`client_id`,`purchase_order_id`) REFERENCES `erp_purchase_orders`(`client_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `fk_erp_po_request` FOREIGN KEY (`client_id`,`purchase_request_id`) REFERENCES `erp_purchase_requests`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `fk_erp_po_quote` FOREIGN KEY (`client_id`,`purchase_quote_id`) REFERENCES `erp_purchase_quotes`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;
