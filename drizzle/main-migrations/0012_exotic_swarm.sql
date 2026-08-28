ALTER TABLE `megadesk_domain_audit_logs` MODIFY COLUMN `success` tinyint DEFAULT 1;--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `operation_id` varchar(36);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `operator_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `operator_role` varchar(20);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `instance_name` varchar(120);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `origin` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `event_phase` enum('intent','success','failure');--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `error_code` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `source_ip` varchar(45);--> statement-breakpoint
ALTER TABLE `megadesk_domain_audit_logs` ADD `metadata_json` json;--> statement-breakpoint
CREATE INDEX `idx_mdal_operation` ON `megadesk_domain_audit_logs` (`operation_id`);