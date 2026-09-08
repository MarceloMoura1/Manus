ALTER TABLE `megadesk_user_settings` ADD `conversation_background_type` varchar(16) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_user_settings` ADD `conversation_background_preset_id` varchar(64);--> statement-breakpoint
ALTER TABLE `megadesk_user_settings` ADD `conversation_background_image_key` varchar(128);