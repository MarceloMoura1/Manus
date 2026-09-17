CREATE TABLE `erp_product_audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`product_id` bigint NOT NULL,
	`entity_type` enum('product','variant','supplier_association') NOT NULL,
	`entity_public_id` varchar(36) NOT NULL,
	`action` varchar(60) NOT NULL,
	`actor_user_id` varchar(80) NOT NULL,
	`actor_name_snapshot` varchar(180) NOT NULL,
	`actor_role` varchar(20) NOT NULL,
	`summary` varchar(255) NOT NULL,
	`changes_json` json,
	`metadata_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_product_audit_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_epal_tenant_public` UNIQUE(`client_id`,`public_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_product_audit_logs` ADD CONSTRAINT `fk_epal_product` FOREIGN KEY (`client_id`,`product_id`) REFERENCES `erp_products`(`client_id`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_epal_tenant_product_created` ON `erp_product_audit_logs` (`client_id`,`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_epal_tenant_entity` ON `erp_product_audit_logs` (`client_id`,`entity_type`,`entity_public_id`);--> statement-breakpoint
CREATE INDEX `idx_epal_tenant_created` ON `erp_product_audit_logs` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_epal_tenant_actor` ON `erp_product_audit_logs` (`client_id`,`actor_user_id`);