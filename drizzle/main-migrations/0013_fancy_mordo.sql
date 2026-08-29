CREATE TABLE `megadesk_conversation_contacts` (
	`contact_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`display_name` varchar(180) NOT NULL,
	`canonical_phone` varchar(40),
	`channel` varchar(40) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`external_identity` varchar(180) NOT NULL,
	`crm_client_id` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_conversation_contacts_contact_id` PRIMARY KEY(`contact_id`),
	CONSTRAINT `uq_mcc_identity` UNIQUE(`client_id`,`channel`,`provider`,`external_identity`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_conversation_events` (
	`event_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`conversation_id` varchar(80) NOT NULL,
	`event_type` varchar(40) NOT NULL,
	`operator_user_id` varchar(80),
	`metadata_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_conversation_events_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_conversation_tickets` (
	`link_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`conversation_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`contact_id` varchar(80),
	`linked_by_user_id` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_conversation_tickets_link_id` PRIMARY KEY(`link_id`),
	CONSTRAINT `uq_mct_tenant_link` UNIQUE(`client_id`,`conversation_id`,`chamado_id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `client_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `external_message_id` varchar(180);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `provider` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `integration_id` varchar(120);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `client_attempt_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `direction` enum('inbound','outbound','system');--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `message_type` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `sender_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `sender_name_snapshot` varchar(180);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD `media_reference` longtext;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `public_code` varchar(24);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `contact_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `origin` enum('inbound','outbound');--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `channel` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `provider` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `integration_id` varchar(120);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `active_key` varchar(255);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `opened_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `closed_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `closed_by_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `reopened_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `reopened_by_user_id` varchar(80);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD `bot_suspended_at` timestamp;--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD CONSTRAINT `uq_mdcm_external` UNIQUE(`client_id`,`provider`,`integration_id`,`external_message_id`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations_messages` ADD CONSTRAINT `uq_mdcm_client_attempt` UNIQUE(`client_id`,`client_attempt_id`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD CONSTRAINT `uq_mdc_public_code` UNIQUE(`public_code`);--> statement-breakpoint
ALTER TABLE `megadesk_domain_conversations` ADD CONSTRAINT `uq_mdc_active_key` UNIQUE(`active_key`);--> statement-breakpoint
CREATE INDEX `idx_mcc_tenant_phone` ON `megadesk_conversation_contacts` (`client_id`,`canonical_phone`);--> statement-breakpoint
CREATE INDEX `idx_mcc_tenant_crm` ON `megadesk_conversation_contacts` (`client_id`,`crm_client_id`);--> statement-breakpoint
CREATE INDEX `idx_mce_tenant_conversation` ON `megadesk_conversation_events` (`client_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mct_tenant_chamado` ON `megadesk_conversation_tickets` (`client_id`,`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdcm_tenant_conversation` ON `megadesk_domain_conversations_messages` (`client_id`,`conversation_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_mdc_tenant_contact` ON `megadesk_domain_conversations` (`client_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_tenant_activity` ON `megadesk_domain_conversations` (`client_id`,`status`,`updated_at`);