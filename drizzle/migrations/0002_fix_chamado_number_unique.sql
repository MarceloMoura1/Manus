-- Remove global unique constraint from chamado_number
ALTER TABLE `megadesk_domain_chamados` DROP INDEX `chamado_number`;

-- Add composite unique index (client_id, chamado_number)
ALTER TABLE `megadesk_domain_chamados` ADD UNIQUE INDEX `idx_mdc_client_chamado_number_unique` (`client_id`, `chamado_number`);
