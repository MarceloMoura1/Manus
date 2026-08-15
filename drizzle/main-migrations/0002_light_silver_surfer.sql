ALTER TABLE `megadesk_crm_clients` MODIFY COLUMN `cpf_cnpj` varchar(20);--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` MODIFY COLUMN `phone` varchar(40);--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` MODIFY COLUMN `email` varchar(255);--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD CONSTRAINT `uq_mcc_tenant_document` UNIQUE(`client_id`,`cpf_cnpj`);--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD CONSTRAINT `uq_mcc_tenant_phone` UNIQUE(`client_id`,`phone`);--> statement-breakpoint
ALTER TABLE `megadesk_crm_clients` ADD CONSTRAINT `uq_mcc_tenant_email` UNIQUE(`client_id`,`email`);