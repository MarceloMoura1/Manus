CREATE TABLE `evolution_failed_messages` (
	`failed_message_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`conversation_id` varchar(255) NOT NULL,
	`message_id` varchar(255),
	`phone_number` varchar(20) NOT NULL,
	`message_text` text NOT NULL,
	`agent_name` varchar(255),
	`status` enum('pendin','etryin','en','ailed_permanent') NOT NULL DEFAULT 'pending',
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
	`status` enum('succes','ailed') NOT NULL DEFAULT 'failed',
	`error` text,
	`error_code` varchar(50),
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	`response_time` int,
	CONSTRAINT `evolution_retry_history_retry_history_id` PRIMARY KEY(`retry_history_id`)
);
--> statement-breakpoint
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
CREATE INDEX `evolution_retry_history_status_idx` ON `evolution_retry_history` (`status`);