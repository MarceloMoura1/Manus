CREATE TABLE `erp_product_media` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`media_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`category` enum('product_image') NOT NULL DEFAULT 'product_image',
	`storage_key` varchar(180) NOT NULL,
	`thumbnail_storage_key` varchar(180) NOT NULL,
	`mime_type` enum('image/jpeg','image/png','image/webp') NOT NULL,
	`byte_size` bigint NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`state` enum('staged','active','pending_delete','deleted') NOT NULL DEFAULT 'staged',
	`active_product_id` bigint GENERATED ALWAYS AS (CASE WHEN `state` = 'active' THEN `product_id` ELSE NULL END) VIRTUAL,
	`client_attempt_id` varchar(36) NOT NULL,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`activated_at` timestamp,
	`pending_delete_at` timestamp,
	`deleted_at` timestamp,
	CONSTRAINT `erp_product_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epm_tenant_media` UNIQUE(`client_id`,`media_id`),
	CONSTRAINT `uq_epm_tenant_attempt` UNIQUE(`client_id`,`client_attempt_id`),
	CONSTRAINT `uq_epm_storage_key` UNIQUE(`storage_key`),
	CONSTRAINT `uq_epm_thumbnail_key` UNIQUE(`thumbnail_storage_key`),
	CONSTRAINT `uq_epm_tenant_product_id` UNIQUE(`client_id`,`product_id`,`id`),
	CONSTRAINT `uq_epm_one_active` UNIQUE(`client_id`,`active_product_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_products` ADD `primary_media_id` bigint;--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `uq_erp_products_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_product_media` ADD CONSTRAINT `fk_epm_tenant_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_epm_tenant_product_state` ON `erp_product_media` (`client_id`,`product_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_epm_reconcile` ON `erp_product_media` (`state`,`created_at`,`pending_delete_at`);--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `fk_erp_products_primary_media` FOREIGN KEY (`client_id`,`id`,`primary_media_id`) REFERENCES `erp_product_media`(`client_id`,`product_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_products_primary_media` ON `erp_products` (`client_id`,`primary_media_id`);