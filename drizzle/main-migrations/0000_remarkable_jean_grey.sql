CREATE TABLE `admin_credentials` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_client_email` UNIQUE(`client_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `evolution_failed_messages` (
	`failed_message_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`conversation_id` varchar(255) NOT NULL,
	`message_id` varchar(255),
	`phone_number` varchar(20) NOT NULL,
	`message_text` text NOT NULL,
	`agent_name` varchar(255),
	`status` enum('pending','retrying','sent','failed_permanent') NOT NULL DEFAULT 'pending',
	`retry_count` int NOT NULL DEFAULT 0,
	`max_retries` int NOT NULL DEFAULT 3,
	`last_error` text,
	`error_code` varchar(50),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`next_retry_at` timestamp,
	`sent_at` timestamp,
	CONSTRAINT `evolution_failed_messages_failed_message_id` PRIMARY KEY(`failed_message_id`)
);
--> statement-breakpoint
CREATE TABLE `evolution_queue_config` (
	`config_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`max_retries` int NOT NULL DEFAULT 3,
	`retry_delay_ms` int NOT NULL DEFAULT 1000,
	`backoff_multiplier` int NOT NULL DEFAULT 2,
	`max_backoff_ms` int NOT NULL DEFAULT 60000,
	`auto_retry_enabled` int NOT NULL DEFAULT 1,
	`cleanup_after_days_success` int NOT NULL DEFAULT 7,
	`cleanup_after_days_failed` int NOT NULL DEFAULT 30,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evolution_queue_config_config_id` PRIMARY KEY(`config_id`),
	CONSTRAINT `evolution_queue_config_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `evolution_queue_metrics` (
	`metrics_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`date` timestamp NOT NULL,
	`total_failed` int NOT NULL DEFAULT 0,
	`total_retried` int NOT NULL DEFAULT 0,
	`total_succeeded` int NOT NULL DEFAULT 0,
	`total_permanent_failed` int NOT NULL DEFAULT 0,
	`avg_retry_count` int NOT NULL DEFAULT 0,
	`avg_response_time_ms` int NOT NULL DEFAULT 0,
	`success_rate` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evolution_queue_metrics_metrics_id` PRIMARY KEY(`metrics_id`)
);
--> statement-breakpoint
CREATE TABLE `evolution_retry_history` (
	`retry_history_id` varchar(255) NOT NULL,
	`failed_message_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`retry_number` int NOT NULL,
	`status` enum('success','failed') NOT NULL DEFAULT 'failed',
	`error` text,
	`error_code` varchar(50),
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	`response_time` int,
	CONSTRAINT `evolution_retry_history_retry_history_id` PRIMARY KEY(`retry_history_id`)
);
--> statement-breakpoint
CREATE TABLE `megaadmin_credentials` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'Administrador',
	`password_hash` varchar(255) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megaadmin_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `megaadmin_email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_company_settings` (
	`setting_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company_name` varchar(255),
	`logo_url` text,
	`email` varchar(255),
	`phone` varchar(20),
	`whatsapp` varchar(20),
	`address` text,
	`business_hours` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_company_settings_setting_id` PRIMARY KEY(`setting_id`),
	CONSTRAINT `uq_client_settings` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_crm_clients` (
	`crm_client_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company_name` varchar(255) NOT NULL,
	`responsible_name` varchar(180) NOT NULL DEFAULT '',
	`cpf_cnpj` varchar(20) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL DEFAULT '',
	`whatsapp` varchar(40) NOT NULL DEFAULT '',
	`email` varchar(255) NOT NULL DEFAULT '',
	`address` varchar(255) NOT NULL DEFAULT '',
	`city` varchar(120) NOT NULL DEFAULT '',
	`state` varchar(2) NOT NULL DEFAULT '',
	`cep` varchar(10) NOT NULL DEFAULT '',
	`status` enum('lead','ativo','inativo','cancelado','inadimplente') NOT NULL DEFAULT 'lead',
	`origin` enum('whatsapp','instagram','facebook','site','indicacao','outro') NOT NULL DEFAULT 'outro',
	`internal_responsible` varchar(180) NOT NULL DEFAULT '',
	`tags` text NOT NULL DEFAULT (''),
	`observations` text NOT NULL DEFAULT (''),
	`contacts_json` text,
	`last_interaction_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_crm_clients_crm_client_id` PRIMARY KEY(`crm_client_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_audit_logs` (
	`audit_id` varchar(100) NOT NULL,
	`platform` enum('MegaAdmin','MegaDesk') NOT NULL,
	`action` varchar(255) NOT NULL,
	`client_id` varchar(80),
	`success` tinyint NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_audit_logs_audit_id` PRIMARY KEY(`audit_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_backups` (
	`backup_id` varchar(80) NOT NULL,
	`backup_date` date NOT NULL,
	`backup_timestamp` timestamp NOT NULL DEFAULT (now()),
	`clients_json` longtext NOT NULL,
	`conversations_json` longtext NOT NULL,
	`tickets_json` longtext NOT NULL,
	`bot_scripts_json` longtext NOT NULL,
	`operational_records_json` longtext NOT NULL,
	`audit_logs_json` longtext NOT NULL,
	`total_clients` int NOT NULL DEFAULT 0,
	`total_conversations` int NOT NULL DEFAULT 0,
	`total_tickets` int NOT NULL DEFAULT 0,
	`status` enum('success','failed','partial') NOT NULL DEFAULT 'success',
	`error_message` text,
	`retention_days` int NOT NULL DEFAULT 30,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_backups_backup_id` PRIMARY KEY(`backup_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_bot_scripts` (
	`script_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`system_prompt` text NOT NULL,
	`initial_message` text NOT NULL,
	`active` tinyint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_bot_scripts_script_id` PRIMARY KEY(`script_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_chamado_activities` (
	`activity_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`attendant` varchar(180) NOT NULL,
	`action_type` enum('register','edit','close','forward','note','attachment') NOT NULL DEFAULT 'note',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamado_activities_activity_id` PRIMARY KEY(`activity_id`)
);
--> statement-breakpoint
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
CREATE TABLE `megadesk_domain_chamado_collaborators` (
	`collaborator_id` varchar(80) NOT NULL,
	`chamado_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`user_name` varchar(180) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_chamado_collaborators_collaborator_id` PRIMARY KEY(`collaborator_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_chamado_sequence` (
	`clientId` varchar(80) NOT NULL,
	`nextChamadoNumber` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamado_sequence_clientId` PRIMARY KEY(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_chamados` (
	`chamadoId` varchar(80) NOT NULL,
	`clientId` varchar(80) NOT NULL,
	`chamadoNumber` int NOT NULL,
	`customerId` varchar(80),
	`customerName` varchar(255),
	`customer_phone` varchar(40),
	`customer_email` varchar(255),
	`customer_cnpj` varchar(20),
	`company` varchar(255),
	`title` varchar(255),
	`observations` text,
	`status` enum('open','in_progress','waiting','closed') DEFAULT 'open',
	`priority` enum('baixa','media','alta','critica') DEFAULT 'media',
	`assignedTo` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_chamados_chamadoId` PRIMARY KEY(`chamadoId`),
	CONSTRAINT `uq_chamado_number` UNIQUE(`clientId`,`chamadoNumber`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_client_users` (
	`user_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` enum('admin','manager','agent','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('active','blocked') NOT NULL DEFAULT 'blocked',
	`permissions_json` longtext NOT NULL,
	`password_hash` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_client_users_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `uq_mdu_client_email` UNIQUE(`client_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_clients` (
	`client_id` varchar(80) NOT NULL,
	`internal_id` varchar(80) NOT NULL,
	`tenant_database_name` varchar(120) NOT NULL,
	`company` varchar(255) NOT NULL,
	`contact` varchar(180) NOT NULL,
	`email` varchar(255),
	`phone` varchar(40) NOT NULL,
	`cnpj` varchar(20),
	`plan` varchar(120) NOT NULL,
	`max_users` int NOT NULL DEFAULT 5,
	`status` enum('active','setup','paused') NOT NULL DEFAULT 'setup',
	`status_type` enum('active','test') NOT NULL DEFAULT 'test',
	`access_released` tinyint NOT NULL DEFAULT 0,
	`api_token` varchar(255) NOT NULL,
	`modules_json` longtext NOT NULL,
	`integrations_json` longtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_clients_client_id` PRIMARY KEY(`client_id`),
	CONSTRAINT `tenant_database_name` UNIQUE(`tenant_database_name`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_conversations` (
	`conversation_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`crm_client_id` varchar(80),
	`customer_name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`company` varchar(255) NOT NULL,
	`status` enum('open','bot','closed') NOT NULL DEFAULT 'open',
	`last_message` text NOT NULL,
	`last_message_from` enum('customer','agent','bot'),
	`time_label` varchar(80) NOT NULL,
	`messages_json` longtext NOT NULL,
	`unread_count` int DEFAULT 0,
	`ia_active` tinyint DEFAULT 0,
	`assigned_user_id` varchar(80),
	`assigned_user_name` varchar(180),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_conversations_conversation_id` PRIMARY KEY(`conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_customers` (
	`customerId` varchar(80) NOT NULL,
	`clientId` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(20),
	`email` varchar(255),
	`company` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_customers_customerId` PRIMARY KEY(`customerId`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_metrics` (
	`metric_id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`metric_type` varchar(80) NOT NULL,
	`amount` int NOT NULL DEFAULT 1,
	`source` varchar(80) NOT NULL DEFAULT 'system',
	`metadata_json` longtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_metrics_metric_id` PRIMARY KEY(`metric_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_operational_records` (
	`record_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`tenant_database_name` varchar(120) NOT NULL,
	`record_type` enum('conversation','ticket','tracking','erp') NOT NULL,
	`owner_phone` varchar(40) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(80) NOT NULL,
	`payload_json` longtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_domain_operational_records_record_id` PRIMARY KEY(`record_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_domain_tickets` (
	`ticket_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`company` varchar(255) NOT NULL,
	`customer` varchar(180) NOT NULL,
	`problem` varchar(255) NOT NULL,
	`category` varchar(120) NOT NULL,
	`status` enum('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
	`created_label` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_domain_tickets_ticket_id` PRIMARY KEY(`ticket_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_notifications` (
	`notification_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('info','success','warning','error','system') NOT NULL DEFAULT 'info',
	`is_read` boolean NOT NULL DEFAULT false,
	`action_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`read_at` timestamp,
	CONSTRAINT `megadesk_notifications_notification_id` PRIMARY KEY(`notification_id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_user_settings` (
	`id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`notifications_enabled` tinyint NOT NULL DEFAULT 1,
	`sound_enabled` tinyint NOT NULL DEFAULT 1,
	`sound_volume` int NOT NULL DEFAULT 70,
	`mute_until` timestamp,
	`desktop_notifications_enabled` tinyint NOT NULL DEFAULT 1,
	`whatsapp_notifications_enabled` tinyint NOT NULL DEFAULT 1,
	`tickets_notifications_enabled` tinyint NOT NULL DEFAULT 1,
	`ia_notifications_enabled` tinyint NOT NULL DEFAULT 1,
	`show_message_preview` tinyint NOT NULL DEFAULT 1,
	`auto_response_enabled` tinyint NOT NULL DEFAULT 0,
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
	CONSTRAINT `uq_mush_client_user_key` UNIQUE(`client_id`,`user_id`,`shortcut_key`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_whatsapp_config` (
	`configId` varchar(80) NOT NULL,
	`clientId` varchar(80) NOT NULL,
	`phoneNumberId` varchar(255),
	`businessAccountId` varchar(255),
	`accessToken` varchar(500),
	`webhookVerifyToken` varchar(255),
	`phoneNumber` varchar(20),
	`webhookUrl` varchar(500),
	`connectionStatus` tinyint DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_whatsapp_config_configId` PRIMARY KEY(`configId`),
	CONSTRAINT `uq_client_whatsapp` UNIQUE(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`open_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'Usuário MegaDesk',
	`email` varchar(255),
	`login_method` varchar(64),
	`role` enum('admin','user') NOT NULL DEFAULT 'user',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`last_signed_in` timestamp,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_open_id_unique` UNIQUE(`open_id`)
);
--> statement-breakpoint
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
	`senderType` enum('customer','agent','bot') NOT NULL,
	`messageType` enum('text','image','audio','video','document','template','sticker','location','reaction') NOT NULL DEFAULT 'text',
	`content` text NOT NULL DEFAULT (''),
	`media_url` text,
	`media_id` varchar(120),
	`caption` text,
	`status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`error_message` text,
	`metadata_json` text NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wa_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wa_msg_client_external` UNIQUE(`client_id`,`wa_message_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_admin_client` ON `admin_credentials` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_admin_email` ON `admin_credentials` (`email`);--> statement-breakpoint
CREATE INDEX `evolution_failed_messages_client_id_idx` ON `evolution_failed_messages` (`client_id`);--> statement-breakpoint
CREATE INDEX `evolution_failed_messages_status_idx` ON `evolution_failed_messages` (`status`);--> statement-breakpoint
CREATE INDEX `evolution_failed_messages_next_retry_idx` ON `evolution_failed_messages` (`next_retry_at`);--> statement-breakpoint
CREATE INDEX `evolution_failed_messages_client_status_idx` ON `evolution_failed_messages` (`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `evolution_queue_config_client_id_idx` ON `evolution_queue_config` (`client_id`);--> statement-breakpoint
CREATE INDEX `evolution_queue_metrics_client_id_idx` ON `evolution_queue_metrics` (`client_id`);--> statement-breakpoint
CREATE INDEX `evolution_queue_metrics_date_idx` ON `evolution_queue_metrics` (`date`);--> statement-breakpoint
CREATE INDEX `evolution_queue_metrics_client_date_idx` ON `evolution_queue_metrics` (`client_id`,`date`);--> statement-breakpoint
CREATE INDEX `evolution_retry_history_failed_message_id_idx` ON `evolution_retry_history` (`failed_message_id`);--> statement-breakpoint
CREATE INDEX `evolution_retry_history_client_id_idx` ON `evolution_retry_history` (`client_id`);--> statement-breakpoint
CREATE INDEX `evolution_retry_history_status_idx` ON `evolution_retry_history` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mcc_client` ON `megadesk_crm_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mcc_status` ON `megadesk_crm_clients` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mcc_company` ON `megadesk_crm_clients` (`company_name`);--> statement-breakpoint
CREATE INDEX `idx_mcc_phone` ON `megadesk_crm_clients` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_mdal_client` ON `megadesk_domain_audit_logs` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdb_date` ON `megadesk_domain_backups` (`backup_date`);--> statement-breakpoint
CREATE INDEX `idx_mdb_timestamp` ON `megadesk_domain_backups` (`backup_timestamp`);--> statement-breakpoint
CREATE INDEX `idx_mdbs_client` ON `megadesk_domain_bot_scripts` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_chamado` ON `megadesk_domain_chamado_activities` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_client` ON `megadesk_domain_chamado_activities` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_att_chamado` ON `megadesk_domain_chamado_attachments` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdca_att_client` ON `megadesk_domain_chamado_attachments` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdcc_chamado` ON `megadesk_domain_chamado_collaborators` (`chamado_id`);--> statement-breakpoint
CREATE INDEX `idx_mdcc_client` ON `megadesk_domain_chamado_collaborators` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_client` ON `megadesk_domain_chamados` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_mdc_status` ON `megadesk_domain_chamados` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mdu_client` ON `megadesk_domain_client_users` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_client` ON `megadesk_domain_conversations` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdc_status` ON `megadesk_domain_conversations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_mdc_client` ON `megadesk_domain_customers` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_mdc_phone` ON `megadesk_domain_customers` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_mdm_client` ON `megadesk_domain_metrics` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdor_client` ON `megadesk_domain_operational_records` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mdor_tenant` ON `megadesk_domain_operational_records` (`tenant_database_name`);--> statement-breakpoint
CREATE INDEX `idx_mdt_client` ON `megadesk_domain_tickets` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_client` ON `megadesk_notifications` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_user` ON `megadesk_notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_client_user` ON `megadesk_notifications` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mn_is_read` ON `megadesk_notifications` (`is_read`);--> statement-breakpoint
CREATE INDEX `idx_mn_created_at` ON `megadesk_notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mush_client_user` ON `megadesk_user_shortcuts` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `users_email` ON `users` (`email`);--> statement-breakpoint
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