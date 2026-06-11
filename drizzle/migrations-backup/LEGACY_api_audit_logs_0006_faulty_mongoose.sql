CREATE TABLE `api_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int,
	`tenantDatabaseName` varchar(120),
	`tokenId` int,
	`action` varchar(120) NOT NULL,
	`method` varchar(12) NOT NULL,
	`path` varchar(500) NOT NULL,
	`statusCode` int NOT NULL,
	`success` tinyint NOT NULL DEFAULT 0,
	`ip` varchar(80),
	`userAgent` varchar(500),
	`ownerPhoneNormalized` varchar(32),
	`recordType` varchar(40),
	`errorMessage` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_integration_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`tenantDatabaseName` varchar(120) NOT NULL,
	`name` varchar(120) NOT NULL DEFAULT 'Token principal',
	`tokenHash` varchar(64) NOT NULL,
	`tokenLast4` varchar(12) NOT NULL,
	`status` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	`rotatedFromTokenId` int,
	`expiresAt` timestamp,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`createdBy` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_integration_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_integration_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `api_audit_logs` ADD CONSTRAINT `api_audit_logs_clientId_megadesk_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `megadesk_clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_integration_tokens` ADD CONSTRAINT `api_integration_tokens_clientId_megadesk_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `megadesk_clients`(`id`) ON DELETE cascade ON UPDATE no action;