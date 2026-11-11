CREATE TABLE `megadesk_ai_usage_logs` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`feature_source` varchar(32) NOT NULL,
	`conversation_id` varchar(36),
	`prompt_tokens` int NOT NULL,
	`completion_tokens` int NOT NULL,
	`total_tokens` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_ai_usage_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_domain_clients` ADD `ai_monthly_token_limit` int DEFAULT 1000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `megadesk_domain_clients` ADD `ai_cycle_renewal_date` timestamp;--> statement-breakpoint
CREATE INDEX `idx_ai_usage_tenant_created` ON `megadesk_ai_usage_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_tenant_user` ON `megadesk_ai_usage_logs` (`tenant_id`,`user_id`);