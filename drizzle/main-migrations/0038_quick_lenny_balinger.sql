CREATE TABLE `erp_sale_documents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`sale_order_id` bigint NOT NULL,
	`client_file_id` bigint NOT NULL,
	`document_type` enum('invoice','content_declaration','other') NOT NULL,
	`upload_idempotency_key` varchar(36) NOT NULL,
	`upload_payload_hash` varchar(64) NOT NULL,
	`state` enum('active','pending_delete','deleted','pending_upload') NOT NULL DEFAULT 'active',
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_by` varchar(80),
	`pending_delete_at` timestamp,
	`deleted_at` timestamp,
	CONSTRAINT `erp_sale_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_sale_documents_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_sale_documents_file` UNIQUE(`client_file_id`),
	CONSTRAINT `uq_erp_sale_documents_tenant_upload_key` UNIQUE(`client_id`,`upload_idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `erp_sale_order_events` MODIFY COLUMN `event_type` enum('created','updated','confirmed','stage_transition','cancelled','address_corrected','payment_registered','document_added','document_removed') NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_crm_client_files` MODIFY COLUMN `state` enum('active','pending_delete','deleted','pending_upload') NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `megadesk_crm_client_files` ADD CONSTRAINT `uq_mccf_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_sale_documents` ADD CONSTRAINT `fk_erp_sale_document_order` FOREIGN KEY (`client_id`,`sale_order_id`) REFERENCES `erp_sale_orders`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_sale_documents` ADD CONSTRAINT `fk_erp_sale_document_client_file` FOREIGN KEY (`client_id`,`client_file_id`) REFERENCES `megadesk_crm_client_files`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_sale_documents_order_state_date` ON `erp_sale_documents` (`client_id`,`sale_order_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_sale_documents_pending_delete` ON `erp_sale_documents` (`state`,`pending_delete_at`);