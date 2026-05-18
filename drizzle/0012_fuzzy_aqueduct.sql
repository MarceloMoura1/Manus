CREATE TABLE `megadesk_domain_chamado_attachments` (
	`attachment_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`file_url` text NOT NULL,
	`file_size` int,
	`mime_type` varchar(100),
	`uploaded_by` varchar(180) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_chamado_attachments_attachment_id` PRIMARY KEY(`attachment_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mdca_chamado` ON `megadesk_domain_chamado_attachments` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_client` ON `megadesk_domain_chamado_attachments` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_created_at` ON `megadesk_domain_chamado_attachments` (`created_at`);