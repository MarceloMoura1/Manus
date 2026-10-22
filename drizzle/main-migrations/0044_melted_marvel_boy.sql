CREATE TABLE `megadesk_erp_services` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`code` varchar(50),
	`category` varchar(100),
	`price` decimal(12,2) NOT NULL,
	`estimated_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
	`estimated_minutes` int,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_erp_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_megadesk_erp_services_tenant` ON `megadesk_erp_services` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_megadesk_erp_services_tenant_name` ON `megadesk_erp_services` (`client_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_megadesk_erp_services_tenant_category` ON `megadesk_erp_services` (`client_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_megadesk_erp_services_tenant_active` ON `megadesk_erp_services` (`client_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_megadesk_erp_services_tenant_code` ON `megadesk_erp_services` (`client_id`,`code`);