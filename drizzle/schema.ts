import { mysqlTable, index, uniqueIndex, varchar, timestamp, int, mysqlEnum, text, longtext, date, bigint, tinyint, boolean } from "drizzle-orm/mysql-core"

export const evolutionFailedMessages = mysqlTable("evolution_failed_messages", {
	failedMessageId: varchar("failed_message_id", { length: 255 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	conversationId: varchar("conversation_id", { length: 255 }).notNull(),
	messageId: varchar("message_id", { length: 255 }),
	phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
	messageText: text("message_text").notNull(),
	agentName: varchar("agent_name", { length: 255 }),
	status: mysqlEnum(['pending','retrying','sent','failed_permanent']).default('pending').notNull(),
	retryCount: int("retry_count").default(0).notNull(),
	maxRetries: int("max_retries").default(3).notNull(),
	lastError: text("last_error"),
	errorCode: varchar("error_code", { length: 50 }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
	nextRetryAt: timestamp("next_retry_at"),
	sentAt: timestamp("sent_at"),
},
(table) => [
	index("evolution_failed_messages_client_id_idx").on(table.clientId),
	index("evolution_failed_messages_status_idx").on(table.status),
	index("evolution_failed_messages_next_retry_idx").on(table.nextRetryAt),
	index("evolution_failed_messages_client_status_idx").on(table.clientId, table.status),
]);

export const evolutionQueueConfig = mysqlTable("evolution_queue_config", {
	configId: varchar("config_id", { length: 255 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	maxRetries: int("max_retries").default(3).notNull(),
	retryDelayMs: int("retry_delay_ms").default(1000).notNull(),
	backoffMultiplier: int("backoff_multiplier").default(2).notNull(),
	maxBackoffMs: int("max_backoff_ms").default(60000).notNull(),
	autoRetryEnabled: int("auto_retry_enabled").default(1).notNull(),
	cleanupAfterDaysSuccess: int("cleanup_after_days_success").default(7).notNull(),
	cleanupAfterDaysFailed: int("cleanup_after_days_failed").default(30).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("evolution_queue_config_client_id_unique").on(table.clientId),
	index("evolution_queue_config_client_id_idx").on(table.clientId),
]);

export const evolutionQueueMetrics = mysqlTable("evolution_queue_metrics", {
	metricsId: varchar("metrics_id", { length: 255 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	date: timestamp().notNull(),
	totalFailed: int("total_failed").default(0).notNull(),
	totalRetried: int("total_retried").default(0).notNull(),
	totalSucceeded: int("total_succeeded").default(0).notNull(),
	totalPermanentFailed: int("total_permanent_failed").default(0).notNull(),
	avgRetryCount: int("avg_retry_count").default(0).notNull(),
	avgResponseTimeMs: int("avg_response_time_ms").default(0).notNull(),
	successRate: int("success_rate").default(0).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("evolution_queue_metrics_client_id_idx").on(table.clientId),
	index("evolution_queue_metrics_date_idx").on(table.date),
	index("evolution_queue_metrics_client_date_idx").on(table.clientId, table.date),
]);

export const evolutionRetryHistory = mysqlTable("evolution_retry_history", {
	retryHistoryId: varchar("retry_history_id", { length: 255 }).primaryKey().notNull(),
	failedMessageId: varchar("failed_message_id", { length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	retryNumber: int("retry_number").notNull(),
	status: mysqlEnum(['success','failed']).default('failed').notNull(),
	error: text(),
	errorCode: varchar("error_code", { length: 50 }),
	attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
	responseTime: int("response_time"),
},
(table) => [
	index("evolution_retry_history_failed_message_id_idx").on(table.failedMessageId),
	index("evolution_retry_history_client_id_idx").on(table.clientId),
	index("evolution_retry_history_status_idx").on(table.status),
]);

export const megadeskCompanySettings = mysqlTable("megadesk_company_settings", {
	settingId: varchar("setting_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	companyName: varchar("company_name", { length: 255 }),
	logoUrl: text("logo_url"),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	whatsapp: varchar({ length: 20 }),
	address: text(),
	businessHours: text("business_hours"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_client_settings").on(table.clientId),
]);

export const megadeskDomainAuditLogs = mysqlTable("megadesk_domain_audit_logs", {
	auditId: varchar("audit_id", { length: 100 }).primaryKey().notNull(),
	platform: mysqlEnum(['MegaAdmin','MegaDesk']).notNull(),
	action: varchar({ length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 80 }),
	success: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdal_client").on(table.clientId),
]);

export const megadeskDomainBackups = mysqlTable("megadesk_domain_backups", {
	backupId: varchar("backup_id", { length: 80 }).primaryKey().notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	backupDate: date("backup_date", { mode: 'string' }).notNull(),
	backupTimestamp: timestamp("backup_timestamp", { mode: 'string' }).defaultNow().notNull(),
	clientsJson: longtext("clients_json").notNull(),
	conversationsJson: longtext("conversations_json").notNull(),
	ticketsJson: longtext("tickets_json").notNull(),
	botScriptsJson: longtext("bot_scripts_json").notNull(),
	operationalRecordsJson: longtext("operational_records_json").notNull(),
	auditLogsJson: longtext("audit_logs_json").notNull(),
	totalClients: int("total_clients").default(0).notNull(),
	totalConversations: int("total_conversations").default(0).notNull(),
	totalTickets: int("total_tickets").default(0).notNull(),
	status: mysqlEnum(['success','failed','partial']).default('success').notNull(),
	errorMessage: text("error_message"),
	retentionDays: int("retention_days").default(30).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdb_date").on(table.backupDate),
	index("idx_mdb_timestamp").on(table.backupTimestamp),
]);

export const megadeskDomainBotScripts = mysqlTable("megadesk_domain_bot_scripts", {
	scriptId: varchar("script_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	name: varchar({ length: 180 }).notNull(),
	description: text().notNull(),
	systemPrompt: text("system_prompt").notNull(),
	initialMessage: text("initial_message").notNull(),
	active: tinyint().default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdbs_client").on(table.clientId),
]);

export const megadeskDomainChamadoSequence = mysqlTable("megadesk_domain_chamado_sequence", {
	clientId: varchar({ length: 80 }).primaryKey().notNull(),
	nextChamadoNumber: int().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const megadeskDomainChamados = mysqlTable("megadesk_domain_chamados", {
	chamadoId: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	chamadoNumber: int().notNull(),
	customerId: varchar({ length: 80 }),
	customerName: varchar({ length: 255 }),
	customerPhone: varchar("customer_phone", { length: 40 }),
	customerEmail: varchar("customer_email", { length: 255 }),
	customerCNPJ: varchar("customer_cnpj", { length: 20 }),
	company: varchar({ length: 255 }),
	title: varchar({ length: 255 }),
	observations: text(),
	status: mysqlEnum(['open','in_progress','waiting','closed']).default('open'),
	priority: mysqlEnum(['baixa','media','alta','critica']).default('media'),
	assignedTo: varchar({ length: 80 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
	index("idx_mdc_status").on(table.status),
	uniqueIndex("uq_chamado_number").on(table.clientId, table.chamadoNumber),
]);

export const megadeskDomainChamadoActivities = mysqlTable("megadesk_domain_chamado_activities", {
	activityId: varchar("activity_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	description: text().notNull(),
	attendant: varchar({ length: 180 }).notNull(),
	actionType: mysqlEnum("action_type", ['register','edit','close','forward','note','attachment']).default('note').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdca_chamado").on(table.chamadoId),
	index("idx_mdca_client").on(table.clientId),
]);

export const megadeskDomainChamadoCollaborators = mysqlTable("megadesk_domain_chamado_collaborators", {
	collaboratorId: varchar("collaborator_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	userName: varchar("user_name", { length: 180 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdcc_chamado").on(table.chamadoId),
	index("idx_mdcc_client").on(table.clientId),
]);

export const megadeskDomainClientUsers = mysqlTable("megadesk_domain_client_users", {
	userId: varchar("user_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	name: varchar({ length: 180 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	role: mysqlEnum(['admin','manager','agent','viewer']).default('viewer').notNull(),
	status: mysqlEnum(['active','blocked']).default('blocked').notNull(),
	permissionsJson: longtext("permissions_json").notNull(),
	passwordHash: varchar("password_hash", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdu_client").on(table.clientId),
	uniqueIndex("uq_mdu_client_email").on(table.clientId, table.email),
]);

export const megadeskDomainClients = mysqlTable("megadesk_domain_clients", {
	clientId: varchar("client_id", { length: 80 }).primaryKey().notNull(),
	internalId: varchar("internal_id", { length: 80 }).notNull(),
	tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	contact: varchar({ length: 180 }).notNull(),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 40 }).notNull(),
	cnpj: varchar({ length: 20 }),
	plan: varchar({ length: 120 }).notNull(),
	maxUsers: int("max_users").default(5).notNull(),
	status: mysqlEnum(['provisioning','active','setup','failed','paused']).default('provisioning').notNull(),
	statusType: mysqlEnum("status_type", ['active','test']).default('test').notNull(),
	accessReleased: tinyint("access_released").default(0).notNull(),
	apiToken: varchar("api_token", { length: 255 }).notNull(),
	modulesJson: longtext("modules_json").notNull(),
	integrationsJson: longtext("integrations_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("tenant_database_name").on(table.tenantDatabaseName),
	uniqueIndex("uq_mdc_company_email").on(table.email),
	uniqueIndex("uq_mdc_company_document").on(table.cnpj),
]);

export const megadeskDomainConversations = mysqlTable("megadesk_domain_conversations", {
	conversationId: varchar("conversation_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	crmClientId: varchar("crm_client_id", { length: 80 }),
	customerName: varchar("customer_name", { length: 180 }).notNull(),
	phone: varchar({ length: 40 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	status: mysqlEnum(['open','bot','closed']).default('open').notNull(),
	lastMessage: text("last_message").notNull(),
	lastMessageFrom: mysqlEnum("last_message_from", ['customer','agent','bot']),
	timeLabel: varchar("time_label", { length: 80 }).notNull(),
	messagesJson: longtext("messages_json").notNull(),
	unreadCount: int("unread_count").default(0),
	iaActive: tinyint("ia_active").default(0),
	assignedUserId: varchar("assigned_user_id", { length: 80 }),
	assignedUserName: varchar("assigned_user_name", { length: 180 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
	index("idx_mdc_status").on(table.status),
]);

export const megadeskDomainCustomers = mysqlTable("megadesk_domain_customers", {
	customerId: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	phone: varchar({ length: 20 }),
	email: varchar({ length: 255 }),
	company: varchar({ length: 255 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
	index("idx_mdc_phone").on(table.phone),
	uniqueIndex("uq_mdc_tenant_phone").on(table.clientId, table.phone),
	uniqueIndex("uq_mdc_tenant_email").on(table.clientId, table.email),
]);

export const megadeskDomainMetrics = mysqlTable("megadesk_domain_metrics", {
	metricId: bigint("metric_id", { mode: "number" }).autoincrement().primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	metricType: varchar("metric_type", { length: 80 }).notNull(),
	amount: int().default(1).notNull(),
	source: varchar({ length: 80 }).default('system').notNull(),
	metadataJson: longtext("metadata_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdm_client").on(table.clientId),
]);

export const megadeskDomainOperationalRecords = mysqlTable("megadesk_domain_operational_records", {
	recordId: varchar("record_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull(),
	recordType: mysqlEnum("record_type", ['conversation','ticket','tracking','erp']).notNull(),
	ownerPhone: varchar("owner_phone", { length: 40 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	status: varchar({ length: 80 }).notNull(),
	payloadJson: longtext("payload_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdor_client").on(table.clientId),
	index("idx_mdor_tenant").on(table.tenantDatabaseName),
]);

export const megadeskDomainTickets = mysqlTable("megadesk_domain_tickets", {
	ticketId: varchar("ticket_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	customer: varchar({ length: 180 }).notNull(),
	problem: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 120 }).notNull(),
	status: mysqlEnum(['open','in_progress','waiting','closed']).default('open').notNull(),
	createdLabel: varchar("created_label", { length: 80 }).notNull(),
	description: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdt_client").on(table.clientId),
]);

export const megadeskWhatsappConfig = mysqlTable("megadesk_whatsapp_config", {
	configId: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	phoneNumberId: varchar({ length: 255 }),
	businessAccountId: varchar({ length: 255 }),
	accessToken: varchar({ length: 500 }),
	webhookVerifyToken: varchar({ length: 255 }),
	phoneNumber: varchar({ length: 20 }),
	webhookUrl: varchar({ length: 500 }),
	connectionStatus: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_client_whatsapp").on(table.clientId),
]);

export const users = mysqlTable("users", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	openId: varchar("open_id", { length: 255 }).notNull(),
	name: varchar({ length: 255 }).default("Usuário MegaDesk").notNull(),
	email: varchar({ length: 255 }),
	loginMethod: varchar("login_method", { length: 64 }),
	role: mysqlEnum(['admin','user']).default('user').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastSignedIn: timestamp("last_signed_in", { mode: 'string' }),
},
(table) => [
	uniqueIndex("users_open_id_unique").on(table.openId),
	index("users_email").on(table.email),
]);

export const waAccounts = mysqlTable("wa_accounts", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	displayName: varchar("display_name", { length: 180 }).default("").notNull(),
	phoneNumberId: varchar("phone_number_id", { length: 80 }).notNull(),
	businessAccountId: varchar("business_account_id", { length: 80 }).notNull(),
	accessToken: text("access_token").notNull(),
	webhookVerifyToken: varchar("webhook_verify_token", { length: 120 }).notNull(),
	status: mysqlEnum(['active','inactive','error']).default('inactive').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_wa_accounts_client").on(table.clientId),
	index("idx_wa_accounts_phone").on(table.phoneNumberId),
]);

export const megadeskOperationalSessions = mysqlTable("megadesk_operational_sessions", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	sessionVersion: int("session_version").default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	lastUsedAt: timestamp("last_used_at", { mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { mode: 'string' }),
},
(table) => [
	uniqueIndex("uq_mos_token_hash").on(table.tokenHash),
	index("idx_mos_user").on(table.userId),
	index("idx_mos_client").on(table.clientId),
	index("idx_mos_expires").on(table.expiresAt),
]);

export const megadeskTenantProvisioningRequests = mysqlTable("megadesk_tenant_provisioning_requests", {
	idempotencyKey: varchar("idempotency_key", { length: 120 }).primaryKey().notNull(),
	payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => [
	index("idx_mtpr_client").on(table.clientId),
]);

export const megadeskTicketStatuses = mysqlTable("megadesk_ticket_statuses", {
	statusId: varchar("status_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	name: varchar({ length: 120 }).notNull(),
	color: varchar({ length: 7 }).default("#3b82f6").notNull(),
	order: int().default(0).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, (table) => [
	index("idx_mts_client").on(table.clientId),
	uniqueIndex("uq_mts_client_name").on(table.clientId, table.name),
]);

export const megadeskCrmTimeline = mysqlTable("megadesk_crm_timeline", {
	timelineId: varchar("timeline_id", { length: 80 }).primaryKey().notNull(),
	crmClientId: varchar("crm_client_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	entryType: varchar("entry_type", { length: 80 }).notNull(),
	description: text().notNull(),
	author: varchar({ length: 180 }).notNull(),
	createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => [
	index("idx_mct_tenant_client").on(table.clientId, table.crmClientId),
]);

export const megadeskConversationMessages = mysqlTable("megadesk_domain_conversations_messages", {
	messageId: varchar("message_id", { length: 100 }).primaryKey().notNull(),
	conversationId: varchar("conversation_id", { length: 80 }).notNull(),
	sender: varchar({ length: 180 }).notNull(),
	message: text().notNull(),
	timestamp: timestamp({ mode: "string" }).defaultNow().notNull(),
	status: varchar({ length: 40 }).notNull(),
	updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, (table) => [
	index("idx_mdcm_conversation").on(table.conversationId),
]);

export const megadeskEvolutionSessions = mysqlTable("megadesk_evolution_sessions", {
	clientId: varchar("client_id", { length: 80 }).primaryKey().notNull(),
	instanceName: varchar("instance_name", { length: 120 }).notNull(),
	status: mysqlEnum(["disconnected", "connecting", "connected"]).default("disconnected").notNull(),
	phoneNumber: varchar("phone_number", { length: 30 }),
	connectedAt: timestamp("connected_at", { mode: "date" }),
	createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().onUpdateNow().notNull(),
}, (table) => [
	uniqueIndex("uq_evo_instance").on(table.instanceName),
]);

export const megadeskIaConversationHistory = mysqlTable("megadesk_domain_ia_conversation_history", {
	historyId: varchar("history_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	messagesJson: text("messages_json").notNull(),
	contextJson: text("context_json").default("{}").notNull(),
	createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, (table) => [
	index("idx_mdich_client").on(table.clientId),
	index("idx_mdich_user").on(table.userId),
	uniqueIndex("uq_mdich_user_client").on(table.userId, table.clientId),
]);

export const megadeskIaConversations = mysqlTable("megadesk_domain_ia_conversations", {
	conversationId: varchar("conversation_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	userMessage: text("user_message").notNull(),
	iaResponse: text("ia_response").notNull(),
	tokensUsed: int("tokens_used").default(0).notNull(),
	tipo: mysqlEnum(["consulta", "relatorio", "acao", "analise"]).default("consulta").notNull(),
	status: mysqlEnum(["sucesso", "erro", "pendente"]).default("sucesso").notNull(),
	errorMessage: text("error_message"),
	metadataJson: text("metadata_json").default("{}").notNull(),
	createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => [
	index("idx_mdic_client").on(table.clientId),
	index("idx_mdic_user").on(table.userId),
	index("idx_mdic_created_at").on(table.createdAt),
]);

export const megadeskIaTokenUsage = mysqlTable("megadesk_ia_token_usage", {
	id: varchar({ length: 100 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userEmail: varchar("user_email", { length: 255 }).notNull(),
	conversationId: varchar("conversation_id", { length: 100 }).notNull(),
	promptTokens: int("prompt_tokens").default(0).notNull(),
	completionTokens: int("completion_tokens").default(0).notNull(),
	totalTokens: int("total_tokens").default(0).notNull(),
	model: varchar({ length: 120 }).notNull(),
	functionCallsCount: int("function_calls_count").default(0).notNull(),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
	index("idx_mitu_client_created").on(table.clientId, table.createdAt),
	index("idx_mitu_client_user").on(table.clientId, table.userEmail),
]);

export const waConversations = mysqlTable("wa_conversations", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	accountId: varchar("account_id", { length: 80 }).notNull(),
	customerName: varchar("customer_name", { length: 180 }).default("").notNull(),
	customerPhone: varchar("customer_phone", { length: 40 }).notNull(),
	lastMessage: text("last_message").default("").notNull(),
	lastMessageAt: timestamp("last_message_at", { mode: 'string' }).defaultNow().notNull(),
	unreadCount: int("unread_count").default(0).notNull(),
	status: mysqlEnum(['open','pending','closed']).default('open').notNull(),
	assignedUserId: varchar("assigned_user_id", { length: 80 }),
	crmClientId: varchar("crm_client_id", { length: 80 }),
	metadataJson: text("metadata_json").default("{}").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_wa_conv_client").on(table.clientId),
	index("idx_wa_conv_account").on(table.accountId),
	index("idx_wa_conv_phone").on(table.customerPhone),
	index("idx_wa_conv_status").on(table.status),
	index("idx_wa_conv_last_msg").on(table.lastMessageAt),
]);

export const waMessages = mysqlTable("wa_messages", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	conversationId: varchar("conversation_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	waMessageId: varchar("wa_message_id", { length: 120 }),
	senderType: mysqlEnum(['customer','agent','bot']).notNull(),
	messageType: mysqlEnum(['text','image','audio','video','document','template','sticker','location','reaction']).default('text').notNull(),
	content: text().default("").notNull(),
	mediaUrl: text("media_url"),
	mediaId: varchar("media_id", { length: 120 }),
	caption: text(),
	status: mysqlEnum(['pending','sent','delivered','read','failed']).default('pending').notNull(),
	errorMessage: text("error_message"),
	metadataJson: text("metadata_json").default("{}").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_wa_msg_conv").on(table.conversationId),
	index("idx_wa_msg_client").on(table.clientId),
	index("idx_wa_msg_wa_id").on(table.waMessageId),
	index("idx_wa_msg_created").on(table.createdAt),
	uniqueIndex("uq_wa_msg_client_external").on(table.clientId, table.waMessageId),
]);

export const megadeskNotifications = mysqlTable("megadesk_notifications", {
	notificationId: varchar("notification_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	message: text().notNull(),
	type: mysqlEnum(['info','success','warning','error','system']).default('info').notNull(),
	isRead: boolean("is_read").default(false).notNull(),
	actionUrl: varchar("action_url", { length: 500 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	readAt: timestamp("read_at", { mode: 'string' }),
}, (table) => [
	index("idx_mn_client").on(table.clientId),
	index("idx_mn_user").on(table.userId),
	index("idx_mn_client_user").on(table.clientId, table.userId),
	index("idx_mn_is_read").on(table.isRead),
	index("idx_mn_created_at").on(table.createdAt),
]);

export const adminCredentials = mysqlTable("admin_credentials", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	active: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_admin_client").on(table.clientId),
	index("idx_admin_email").on(table.email),
	uniqueIndex("uq_admin_client_email").on(table.clientId, table.email),
]);

// ─── Tabelas adicionais (Chamados, CRM) ──────────────────────────────────────

export const megadeskDomainChamadoAttachments = mysqlTable("megadesk_domain_chamado_attachments", {
	attachmentId: varchar("attachment_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	fileName: varchar("file_name", { length: 255 }).notNull(),
	fileUrl: text("file_url").notNull(),
	fileSize: int("file_size"),
	mimeType: varchar("mime_type", { length: 100 }),
	uploadedBy: varchar("uploaded_by", { length: 180 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdca_att_chamado").on(table.chamadoId),
	index("idx_mdca_att_client").on(table.clientId),
]);

export const megadeskCrmClients = mysqlTable("megadesk_crm_clients", {
	crmClientId: varchar("crm_client_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	companyName: varchar("company_name", { length: 255 }).notNull(),
	responsibleName: varchar("responsible_name", { length: 180 }).default("").notNull(),
	cpfCnpj: varchar("cpf_cnpj", { length: 20 }),
	phone: varchar({ length: 40 }),
	whatsapp: varchar({ length: 40 }).default("").notNull(),
	email: varchar({ length: 255 }),
	address: varchar({ length: 255 }).default("").notNull(),
	city: varchar({ length: 120 }).default("").notNull(),
	state: varchar({ length: 2 }).default("").notNull(),
	cep: varchar({ length: 10 }).default("").notNull(),
	status: mysqlEnum(['lead','ativo','inativo','cancelado','inadimplente']).default('lead').notNull(),
	origin: mysqlEnum(['whatsapp','instagram','facebook','site','indicacao','outro']).default('outro').notNull(),
	internalResponsible: varchar("internal_responsible", { length: 180 }).default("").notNull(),
	tags: text().default("").notNull(),
	observations: text().default("").notNull(),
	contactsJson: text("contacts_json"),
	lastInteractionAt: timestamp("last_interaction_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mcc_client").on(table.clientId),
	index("idx_mcc_status").on(table.status),
	index("idx_mcc_company").on(table.companyName),
	index("idx_mcc_phone").on(table.phone),
	uniqueIndex("uq_mcc_tenant_document").on(table.clientId, table.cpfCnpj),
	uniqueIndex("uq_mcc_tenant_phone").on(table.clientId, table.phone),
	uniqueIndex("uq_mcc_tenant_email").on(table.clientId, table.email),
]);

export const megaadminCredentials = mysqlTable("megaadmin_credentials", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).default("Administrador").notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	active: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("megaadmin_email").on(table.email),
]);

// ─── User Settings e Shortcuts ───────────────────────────────────────────────

export const megadeskUserSettings = mysqlTable("megadesk_user_settings", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	notificationsEnabled: tinyint("notifications_enabled").default(1).notNull(),
	soundEnabled: tinyint("sound_enabled").default(1).notNull(),
	soundVolume: int("sound_volume").default(70).notNull(),
	muteUntil: timestamp("mute_until", { mode: 'string' }),
	desktopNotificationsEnabled: tinyint("desktop_notifications_enabled").default(1).notNull(),
	whatsappNotificationsEnabled: tinyint("whatsapp_notifications_enabled").default(1).notNull(),
	ticketsNotificationsEnabled: tinyint("tickets_notifications_enabled").default(1).notNull(),
	iaNotificationsEnabled: tinyint("ia_notifications_enabled").default(1).notNull(),
	showMessagePreview: tinyint("show_message_preview").default(1).notNull(),
	autoResponseEnabled: tinyint("auto_response_enabled").default(0).notNull(),
	autoResponseMessage: text("auto_response_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("idx_mus_client_user").on(table.clientId, table.userId),
]);

export const megadeskUserShortcuts = mysqlTable("megadesk_user_shortcuts", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	shortcutKey: varchar("shortcut_key", { length: 50 }).notNull(),
	shortcutMessage: text("shortcut_message").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mush_client_user").on(table.clientId, table.userId),
	uniqueIndex("uq_mush_client_user_key").on(table.clientId, table.userId, table.shortcutKey),
]);
