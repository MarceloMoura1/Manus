ALTER TABLE `megadesk_domain_chamado_activities` MODIFY COLUMN `action_type` enum('register','edit','close','forward','note','attachment','ticket_created','manual_activity','status_changed','collaborator_added','collaborator_removed','ticket_edited','ticket_forwarded','attachment_added') NOT NULL DEFAULT 'note';--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` MODIFY COLUMN `file_url` text;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_activities` ADD `actor_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_activities` ADD `metadata_json` json;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `storage_key` varchar(255);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `uploaded_by_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `sha256` char(64);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `client_attempt_id` varchar(36);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD `attachment_state` enum('legacy','staged','active','pending_delete','deleted') DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD CONSTRAINT `uq_mdca_att_storage_key` UNIQUE(`storage_key`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD CONSTRAINT `uq_mdca_att_client_attempt` UNIQUE(`client_id`,`client_attempt_id`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD CONSTRAINT `uq_mdc_client_chamado` UNIQUE(`clientId`,`chamadoId`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_activities` ADD CONSTRAINT `fk_mdca_tenant_chamado` FOREIGN KEY (`client_id`,`chamado_id`) REFERENCES `megadesk_domain_chamados`(`clientId`,`chamadoId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamado_attachments` ADD CONSTRAINT `fk_mdca_att_tenant_chamado` FOREIGN KEY (`client_id`,`chamado_id`) REFERENCES `megadesk_domain_chamados`(`clientId`,`chamadoId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_mdca_client_chamado_created` ON `megadesk_domain_chamado_activities` (`client_id`,`chamado_id`,`created_at`,`activity_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_att_client_chamado_created` ON `megadesk_domain_chamado_attachments` (`client_id`,`chamado_id`,`created_at`,`attachment_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_att_state_created` ON `megadesk_domain_chamado_attachments` (`attachment_state`,`created_at`);