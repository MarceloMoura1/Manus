CREATE TABLE `megadesk_company_settings` (
	`setting_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company_name` varchar(255) NOT NULL DEFAULT '',
	`logo_url` text,
	`email` varchar(255) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL DEFAULT '',
	`whatsapp` varchar(40) NOT NULL DEFAULT '',
	`address` varchar(255) NOT NULL DEFAULT '',
	`business_hours` text NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_company_settings_setting_id` PRIMARY KEY(`setting_id`),
	CONSTRAINT `megadesk_company_settings_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mcs_client` ON `megadesk_company_settings` (`client_id`);
