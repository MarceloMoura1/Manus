CREATE TABLE `audit_logs` (
	`id` varchar(100) NOT NULL,
	`action` varchar(255) NOT NULL,
	`user_id` varchar(80),
	`user_email` varchar(255),
	`details` text,
	`success` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_scripts` (
	`id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`system_prompt` text NOT NULL,
	`initial_message` text NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`training_data` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_scripts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` varchar(80) NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`status` enum('open','bot','closed') NOT NULL DEFAULT 'open',
	`channel` varchar(40) NOT NULL DEFAULT 'whatsapp',
	`last_message` text NOT NULL,
	`messages` text NOT NULL,
	`assigned_agent` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` varchar(80) NOT NULL,
	`type` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`credentials` text,
	`active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operational_records` (
	`id` varchar(80) NOT NULL,
	`type` enum('conversation','ticket','tracking','erp') NOT NULL,
	`owner_phone` varchar(40) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(80) NOT NULL,
	`payload` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operational_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` varchar(80) NOT NULL,
	`ticket_code` varchar(40) NOT NULL,
	`customer_name` varchar(180) NOT NULL,
	`category` enum('venda','suporte','financeiro','reclamacao','duvida','agendamento','pos_venda') NOT NULL,
	`status` enum('aberto','em_progresso','aguardando_cliente','resolvido') NOT NULL DEFAULT 'aberto',
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`assigned_agent` varchar(255),
	`priority` enum('baixa','media','alta','urgente') NOT NULL DEFAULT 'media',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_ticket_code_unique` UNIQUE(`ticket_code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` enum('admin','manager','agent','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('active','blocked') NOT NULL DEFAULT 'blocked',
	`permissions` text,
	`password_hash` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bot_scripts_active` ON `bot_scripts` (`active`);--> statement-breakpoint
CREATE INDEX `idx_conversations_status` ON `conversations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_conversations_phone` ON `conversations` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_integrations_type` ON `integrations` (`type`);--> statement-breakpoint
CREATE INDEX `idx_operational_records_type` ON `operational_records` (`type`);--> statement-breakpoint
CREATE INDEX `idx_operational_records_created` ON `operational_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tickets_status` ON `tickets` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tickets_category` ON `tickets` (`category`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);