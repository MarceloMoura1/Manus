-- Create admin_credentials table with client isolation
CREATE TABLE IF NOT EXISTS `admin_credentials` (
  `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `client_id` varchar(80) NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `active` tinyint NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX `idx_admin_client` (`client_id`),
  INDEX `idx_admin_email` (`email`),
  
  -- Unique constraint: one email per client
  UNIQUE KEY `uq_admin_client_email` (`client_id`, `email`),
  
  -- Foreign key to ensure client exists
  CONSTRAINT `fk_admin_client_id` FOREIGN KEY (`client_id`) 
    REFERENCES `megadesk_domain_clients` (`client_id`) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
