-- Criar tabela de sequência de chamados
CREATE TABLE IF NOT EXISTS `megadesk_domain_chamado_sequence` (
  `clientId` varchar(80) NOT NULL PRIMARY KEY,
  `nextChamadoNumber` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Criar tabela de chamados
CREATE TABLE IF NOT EXISTS `megadesk_domain_chamados` (
  `chamadoId` varchar(80) NOT NULL PRIMARY KEY,
  `clientId` varchar(80) NOT NULL,
  `chamadoNumber` int NOT NULL UNIQUE,
  `customerId` varchar(80) NOT NULL,
  `customerName` varchar(180) NOT NULL,
  `company` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `observations` text NOT NULL DEFAULT '',
  `status` enum('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
  `priority` enum('baixa','media','alta','critica') NOT NULL DEFAULT 'media',
  `assignedTo` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_mdc_client` (`clientId`),
  KEY `idx_mdc_status` (`status`),
  KEY `idx_mdc_chamado_number` (`chamadoNumber`),
  KEY `idx_mdc_priority` (`priority`),
  KEY `idx_mdc_assigned_to` (`assignedTo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Criar tabela de atividades de chamados
CREATE TABLE IF NOT EXISTS `megadesk_domain_chamado_activities` (
  `activityId` varchar(80) NOT NULL PRIMARY KEY,
  `chamadoId` varchar(80) NOT NULL,
  `clientId` varchar(80) NOT NULL,
  `description` text NOT NULL,
  `attendant` varchar(180) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_mdca_chamado` (`chamadoId`),
  KEY `idx_mdca_client` (`clientId`),
  KEY `idx_mdca_created` (`createdAt`),
  CONSTRAINT `fk_mdca_chamado` FOREIGN KEY (`chamadoId`) REFERENCES `megadesk_domain_chamados` (`chamadoId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
