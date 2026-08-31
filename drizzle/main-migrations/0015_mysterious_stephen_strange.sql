ALTER TABLE `megadesk_crm_clients` ADD `lifecycle_state` enum('active','inactive','archived') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD `pre_archive_state` enum('active','inactive');--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD `lifecycle_changed_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD `archived_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD `lifecycle_version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_mcc_tenant_lifecycle` ON `megadesk_crm_clients` (`client_id`,`lifecycle_state`);