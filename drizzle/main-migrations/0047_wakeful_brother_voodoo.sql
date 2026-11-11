CREATE TABLE `megadesk_ai_routine_logs` (
	`id` varchar(255) NOT NULL,
	`routine_id` varchar(255) NOT NULL,
	`tenant_id` varchar(255) NOT NULL,
	`status` enum('success','warning','error') NOT NULL,
	`output_summary` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_ai_routine_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `megadesk_ai_routines` (
	`id` varchar(255) NOT NULL,
	`tenant_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`schedule_time` varchar(10) NOT NULL,
	`schedule_days` json NOT NULL,
	`trigger_type` varchar(50) NOT NULL,
	`prompt_instruction` text NOT NULL,
	`action_target` varchar(50) NOT NULL DEFAULT 'chat_thread',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_run_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_ai_routines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_ai_routine_logs` ADD CONSTRAINT `megadesk_ai_routine_logs_routine_id_megadesk_ai_routines_id_fk` FOREIGN KEY (`routine_id`) REFERENCES `megadesk_ai_routines`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ai_routine_logs_routine_created` ON `megadesk_ai_routine_logs` (`routine_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_routines_tenant_active` ON `megadesk_ai_routines` (`tenant_id`,`is_active`);