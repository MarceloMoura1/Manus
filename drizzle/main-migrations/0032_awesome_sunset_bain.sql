CREATE TABLE `erp_supplier_files` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`supplier_id` bigint NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`category` varchar(64) NOT NULL,
	`description` text,
	`mime_type` varchar(128) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`state` enum('active','deleted') NOT NULL DEFAULT 'active',
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_by` varchar(80),
	`deleted_at` timestamp,
	CONSTRAINT `erp_supplier_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_esf_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_esf_storage_key` UNIQUE(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `erp_supplier_files` ADD CONSTRAINT `fk_esf_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_supplier_files` ADD CONSTRAINT `fk_esf_supplier` FOREIGN KEY (`client_id`,`supplier_id`) REFERENCES `erp_suppliers`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_esf_lookup` ON `erp_supplier_files` (`client_id`,`supplier_id`,`state`,`created_at`);