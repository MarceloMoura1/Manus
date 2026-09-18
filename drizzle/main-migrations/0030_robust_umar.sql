ALTER TABLE `erp_product_media` DROP INDEX `uq_epm_one_active`;--> statement-breakpoint
ALTER TABLE `erp_product_media` ADD `display_order` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_epm_tenant_product_order` ON `erp_product_media` (`client_id`,`product_id`,`display_order`,`id`);