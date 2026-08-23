CREATE TABLE `erp_suppliers` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`legal_name` varchar(180) NOT NULL,
	`trade_name` varchar(180),
	`person_type` enum('legal','individual') NOT NULL,
	`tax_id` varchar(14),
	`state_registration` varchar(40),
	`email` varchar(254),
	`phone` varchar(30),
	`contact_name` varchar(120),
	`postal_code` varchar(8),
	`street` varchar(180),
	`address_number` varchar(30),
	`address_complement` varchar(120),
	`district` varchar(120),
	`city` varchar(120),
	`state` varchar(2),
	`notes` text,
	`active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(80) NOT NULL,
	`updated_by` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_suppliers_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_suppliers_tenant_tax_id` UNIQUE(`client_id`,`tax_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_erp_suppliers_tenant_legal_name` ON `erp_suppliers` (`client_id`,`legal_name`);--> statement-breakpoint
CREATE INDEX `idx_erp_suppliers_tenant_active` ON `erp_suppliers` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_erp_suppliers_tenant_city_state` ON `erp_suppliers` (`client_id`,`city`,`state`);