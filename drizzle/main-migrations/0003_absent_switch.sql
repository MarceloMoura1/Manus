CREATE TABLE `megadesk_tenant_provisioning_requests` (
	`idempotency_key` varchar(120) NOT NULL,
	`payload_hash` varchar(64) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `megadesk_tenant_provisioning_requests_idempotency_key` PRIMARY KEY(`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_mtpr_client` ON `megadesk_tenant_provisioning_requests` (`client_id`);