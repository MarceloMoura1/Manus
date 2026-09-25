CREATE TABLE `megadesk_crm_client_files` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`crm_client_id` varchar(80) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`category` varchar(64) NOT NULL,
	`description` text,
	`mime_type` varchar(128) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`state` enum('active','pending_delete','deleted') NOT NULL DEFAULT 'active',
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_by` varchar(80),
	`deleted_at` timestamp,
	`pending_delete_at` timestamp,
	CONSTRAINT `megadesk_crm_client_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mccf_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_mccf_storage_key` UNIQUE(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD CONSTRAINT `uq_mcc_tenant_crm` UNIQUE(`client_id`,`crm_client_id`);--> statement-breakpoint
ALTER TABLE `megadesk_crm_client_files` ADD CONSTRAINT `fk_mccf_tenant` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_crm_client_files` ADD CONSTRAINT `fk_mccf_crm_client` FOREIGN KEY (`client_id`,`crm_client_id`) REFERENCES `megadesk_crm_clients`(`client_id`,`crm_client_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_mccf_lookup` ON `megadesk_crm_client_files` (`client_id`,`crm_client_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mccf_pending_delete` ON `megadesk_crm_client_files` (`state`,`pending_delete_at`);