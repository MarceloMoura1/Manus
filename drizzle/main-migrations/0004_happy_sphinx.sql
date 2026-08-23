CREATE TABLE `megadesk_operational_sessions` (
	`id` varchar(80) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`session_version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`last_used_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	CONSTRAINT `megadesk_operational_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_mos_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_mos_user` ON `megadesk_operational_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mos_client` ON `megadesk_operational_sessions` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mos_expires` ON `megadesk_operational_sessions` (`expires_at`);