CREATE TABLE `megadesk_conversation_pending_receipts` (
	`receipt_id` char(36) NOT NULL,
	`client_id` varchar(80) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`integration_id` varchar(120) NOT NULL,
	`external_message_id` varchar(180) NOT NULL,
	`status` varchar(40) NOT NULL,
	`status_rank` int NOT NULL,
	`provider_event_at` timestamp,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`replay_state` enum('pending','replayed') NOT NULL DEFAULT 'pending',
	`message_id` varchar(100),
	`replayed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `megadesk_conversation_pending_receipts_receipt_id` PRIMARY KEY(`receipt_id`),
	CONSTRAINT `uq_mdpr_external_scope` UNIQUE(`client_id`,`provider`,`integration_id`,`external_message_id`)
);
--> statement-breakpoint
ALTER TABLE `megadesk_conversation_pending_receipts` ADD CONSTRAINT `fk_mdpr_client` FOREIGN KEY (`client_id`) REFERENCES `megadesk_domain_clients`(`client_id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_mdpr_expiry` ON `megadesk_conversation_pending_receipts` (`expires_at`,`replay_state`);--> statement-breakpoint
CREATE INDEX `idx_mdpr_tenant_state` ON `megadesk_conversation_pending_receipts` (`client_id`,`replay_state`,`updated_at`);