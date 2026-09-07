ALTER TABLE `megadesk_conversation_events` ADD `anchor_message_id` varchar(100);--> statement-breakpoint
ALTER TABLE `megadesk_conversation_events` ADD `timeline_anchor_kind` enum('message','before_first');--> statement-breakpoint
CREATE INDEX `idx_mce_tenant_conversation_anchor` ON `megadesk_conversation_events` (`client_id`,`conversation_id`,`anchor_message_id`);