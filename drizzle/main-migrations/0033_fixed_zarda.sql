ALTER TABLE `erp_supplier_files` MODIFY COLUMN `state` enum('active','pending_delete','deleted') NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `erp_supplier_files` ADD `pending_delete_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `physical_cleanup_eligible_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `cleanup_lifecycle_version` tinyint;--> statement-breakpoint
CREATE INDEX `idx_esf_pending_delete` ON `erp_supplier_files` (`state`,`pending_delete_at`);--> statement-breakpoint
CREATE INDEX `idx_mdca_att_physical_cleanup` ON `megadesk_domain_chamado_attachments` (`attachment_state`,`cleanup_lifecycle_version`,`physical_cleanup_eligible_at`);
