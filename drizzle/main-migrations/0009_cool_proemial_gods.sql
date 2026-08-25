CREATE TABLE `erp_financial_accounts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`type` enum('cash','bank') NOT NULL,
	`initial_balance_cents` bigint NOT NULL,
	`current_balance_cents` bigint NOT NULL,
	`allow_negative` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_financial_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fin_accounts_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fin_accounts_tenant_name` UNIQUE(`client_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `erp_financial_categories` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`direction` enum('payable','receivable','both') NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_financial_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fin_categories_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fin_categories_tenant_name` UNIQUE(`client_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `erp_financial_entries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`document_number` varchar(80) NOT NULL,
	`direction` enum('payable','receivable') NOT NULL,
	`status` enum('open','settled','cancelled') NOT NULL DEFAULT 'open',
	`description` varchar(500) NOT NULL,
	`amount_cents` bigint NOT NULL,
	`due_date` date NOT NULL,
	`issue_date` date NOT NULL,
	`category_id` bigint NOT NULL,
	`financial_account_id` bigint,
	`supplier_id` bigint,
	`crm_client_id` varchar(80),
	`source_type` enum('manual','purchase_order','sales_order') NOT NULL,
	`source_public_id` varchar(36),
	`party_name_snapshot` varchar(255),
	`notes` text,
	`settled_at` timestamp,
	`settled_by` varchar(80),
	`cancelled_at` timestamp,
	`cancelled_by` varchar(80),
	`cancellation_reason` varchar(500),
	`created_by` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_financial_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fin_entries_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fin_entries_tenant_source` UNIQUE(`client_id`,`source_type`,`source_public_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_financial_ledger` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`financial_account_id` bigint NOT NULL,
	`financial_entry_id` bigint,
	`settlement_id` bigint,
	`type` enum('opening_balance','payable_settlement','receivable_settlement') NOT NULL,
	`amount_cents` bigint NOT NULL,
	`previous_balance_cents` bigint NOT NULL,
	`resulting_balance_cents` bigint NOT NULL,
	`occurred_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(80) NOT NULL,
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_financial_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fin_ledger_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fin_ledger_settlement` UNIQUE(`settlement_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_financial_settlements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`financial_entry_id` bigint NOT NULL,
	`financial_account_id` bigint NOT NULL,
	`idempotency_key` varchar(100) NOT NULL,
	`amount_cents` bigint NOT NULL,
	`settled_by` varchar(80) NOT NULL,
	`settled_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_financial_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_erp_fin_settlements_tenant_public` UNIQUE(`client_id`,`public_id`),
	CONSTRAINT `uq_erp_fin_settlements_tenant_entry` UNIQUE(`client_id`,`financial_entry_id`),
	CONSTRAINT `uq_erp_fin_settlements_tenant_key` UNIQUE(`client_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD CONSTRAINT `fk_erp_fin_entry_category` FOREIGN KEY (`category_id`) REFERENCES `erp_financial_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD CONSTRAINT `fk_erp_fin_entry_account` FOREIGN KEY (`financial_account_id`) REFERENCES `erp_financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_entries` ADD CONSTRAINT `fk_erp_fin_entry_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `erp_suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_ledger` ADD CONSTRAINT `fk_erp_fin_ledger_account` FOREIGN KEY (`financial_account_id`) REFERENCES `erp_financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_ledger` ADD CONSTRAINT `fk_erp_fin_ledger_entry` FOREIGN KEY (`financial_entry_id`) REFERENCES `erp_financial_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_ledger` ADD CONSTRAINT `fk_erp_fin_ledger_settlement` FOREIGN KEY (`settlement_id`) REFERENCES `erp_financial_settlements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_settlements` ADD CONSTRAINT `fk_erp_fin_settlement_entry` FOREIGN KEY (`financial_entry_id`) REFERENCES `erp_financial_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_financial_settlements` ADD CONSTRAINT `fk_erp_fin_settlement_account` FOREIGN KEY (`financial_account_id`) REFERENCES `erp_financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_erp_fin_accounts_tenant_active` ON `erp_financial_accounts` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_erp_fin_categories_tenant_active` ON `erp_financial_categories` (`client_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_erp_fin_entries_tenant_status_due` ON `erp_financial_entries` (`client_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_fin_entries_tenant_direction_issue` ON `erp_financial_entries` (`client_id`,`direction`,`issue_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_fin_ledger_tenant_account_date` ON `erp_financial_ledger` (`client_id`,`financial_account_id`,`occurred_at`);