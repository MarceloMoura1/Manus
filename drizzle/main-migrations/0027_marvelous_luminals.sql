CREATE TABLE `erp_product_suppliers` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`supplier_id` bigint NOT NULL,
	`supplier_product_code` varchar(80),
	`cost_price_cents` bigint,
	`is_preferred` tinyint NOT NULL DEFAULT 0,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_product_suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_eps_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_eps_tenant_id` UNIQUE(`client_id`,`id`),
	CONSTRAINT `uq_eps_tenant_product_supplier` UNIQUE(`client_id`,`product_id`,`supplier_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_suppliers` ADD CONSTRAINT `uq_erp_suppliers_tenant_id` UNIQUE(`client_id`,`id`);--> statement-breakpoint
ALTER TABLE `erp_product_suppliers` ADD CONSTRAINT `fk_eps_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_suppliers` ADD CONSTRAINT `fk_eps_supplier` FOREIGN KEY (`client_id`,`supplier_id`) REFERENCES `erp_suppliers`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_eps_tenant_product` ON `erp_product_suppliers` (`client_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_eps_tenant_supplier` ON `erp_product_suppliers` (`client_id`,`supplier_id`);--> statement-breakpoint
CREATE INDEX `idx_eps_tenant_preferred` ON `erp_product_suppliers` (`client_id`,`product_id`,`is_preferred`);--> statement-breakpoint
CREATE INDEX `idx_eps_tenant_active` ON `erp_product_suppliers` (`client_id`,`active`);