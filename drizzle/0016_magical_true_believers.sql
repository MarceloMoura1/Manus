CREATE TABLE `megadesk_bot_scripts` (
	`script_id` varchar(80) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`system_prompt` text NOT NULL,
	`initial_message` text,
	`is_active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_bot_scripts_script_id` PRIMARY KEY(`script_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mbs_client` ON `megadesk_bot_scripts` (`client_id`);