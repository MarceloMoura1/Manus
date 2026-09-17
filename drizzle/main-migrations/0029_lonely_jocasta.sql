ALTER TABLE `erp_product_variants` ADD `barcode` varchar(80);--> statement-breakpoint
ALTER TABLE `erp_product_variants` ADD `cost_price_cents` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_product_variants` ADD CONSTRAINT `uq_epv_tenant_barcode` UNIQUE(`client_id`,`barcode`);