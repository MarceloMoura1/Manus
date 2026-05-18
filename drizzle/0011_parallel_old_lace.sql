CREATE TABLE `wa_accounts` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`display_name` varchar(180) NOT NULL DEFAULT '',
	`phone_number_id` varchar(80) NOT NULL,
	`business_account_id` varchar(80) NOT NULL,
	`access_token` text NOT NULL,
	`webhook_verify_token` varchar(120) NOT NULL,
	`status` enum('active','inactive','error') NOT NULL DEFAULT 'inactive',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wa_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_conversations` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`account_id` varchar(80) NOT NULL,
	`customer_name` varchar(180) NOT NULL DEFAULT '',
	`customer_phone` varchar(40) NOT NULL,
	`last_message` text NOT NULL DEFAULT (''),
	`last_message_at` timestamp NOT NULL DEFAULT (now()),
	`unread_count` int NOT NULL DEFAULT 0,
	`status` enum('open','pending','closed') NOT NULL DEFAULT 'open',
	`assigned_user_id` varchar(80),
	`crm_client_id` varchar(80),
	`metadata_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wa_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_messages` (
	`id` varchar(80) NOT NULL,
	`conversation_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`wa_message_id` varchar(120),
	`sender_type` enum('customer','agent','bot') NOT NULL,
	`message_type` enum('text','image','audio','video','document','template','sticker','location','reaction') NOT NULL DEFAULT 'text',
	`content` text NOT NULL DEFAULT (''),
	`media_url` text,
	`media_id` varchar(120),
	`caption` text,
	`status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`error_message` text,
	`metadata_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wa_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD `customer_phone` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD `customer_email` varchar(255);--> statement-breakpoint
ALTER TABLE `megadesk_domain_chamados` ADD `customer_cnpj` varchar(20);--> statement-breakpoint
CREATE INDEX `idx_wa_accounts_client` ON `wa_accounts` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_accounts_phone` ON `wa_accounts` (`phone_number_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_client` ON `wa_conversations` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_account` ON `wa_conversations` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_phone` ON `wa_conversations` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_status` ON `wa_conversations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_last_msg` ON `wa_conversations` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_conv` ON `wa_messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_client` ON `wa_messages` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_wa_id` ON `wa_messages` (`wa_message_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_created` ON `wa_messages` (`created_at`);