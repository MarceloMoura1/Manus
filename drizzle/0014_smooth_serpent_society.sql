CREATE TABLE `megadesk_user_settings` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`notifications_enabled` boolean NOT NULL DEFAULT true,
	`sound_enabled` boolean NOT NULL DEFAULT true,
	`sound_volume` int NOT NULL DEFAULT 70,
	`mute_until` timestamp,
	`desktop_notifications_enabled` boolean NOT NULL DEFAULT true,
	`whatsapp_notifications_enabled` boolean NOT NULL DEFAULT true,
	`tickets_notifications_enabled` boolean NOT NULL DEFAULT true,
	`ia_notifications_enabled` boolean NOT NULL DEFAULT true,
	`erp_notifications_enabled` boolean NOT NULL DEFAULT true,
	`tracking_notifications_enabled` boolean NOT NULL DEFAULT true,
	`show_message_preview` boolean NOT NULL DEFAULT true,
	`auto_response_enabled` boolean NOT NULL DEFAULT false,
	`auto_response_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_mus_client_user` UNIQUE(`client_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_user_shortcuts` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`shortcut_key` varchar(50) NOT NULL,
	`shortcut_message` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_user_shortcuts_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_mus_client_user_key` UNIQUE(`client_id`,`user_id`,`shortcut_key`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_whatsapp_config` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`phone_number_id` varchar(255) NOT NULL,
	`business_account_id` varchar(255) NOT NULL,
	`access_token` text NOT NULL,
	`webhook_verify_token` varchar(255) NOT NULL,
	`webhook_url` varchar(500),
	`phone_number` varchar(20),
	`is_connected` boolean NOT NULL DEFAULT false,
	`connection_status` boolean NOT NULL DEFAULT false,
	`webhook_status` enum('pending','verified','failed') NOT NULL DEFAULT 'pending',
	`last_webhook_test` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_whatsapp_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `megadesk_whatsapp_config_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mus_client` ON `megadesk_user_settings` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mus_user` ON `megadesk_user_settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mus_client` ON `megadesk_user_shortcuts` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mus_user` ON `megadesk_user_shortcuts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mwc_client` ON `megadesk_whatsapp_config` (`client_id`);