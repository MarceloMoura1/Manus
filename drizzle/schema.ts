import {
  mysqlTable,
  index,
  uniqueIndex,
  foreignKey,
  varchar,
  timestamp,
  int,
  mysqlEnum,
  text,
  longtext,
  date,
  bigint,
  tinyint,
  boolean,
  decimal,
  json,
} from "drizzle-orm/mysql-core";

export const evolutionFailedMessages = mysqlTable(
  "evolution_failed_messages",
  {
    failedMessageId: varchar("failed_message_id", { length: 255 })
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    conversationId: varchar("conversation_id", { length: 255 }).notNull(),
    messageId: varchar("message_id", { length: 255 }),
    phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
    messageText: text("message_text").notNull(),
    agentName: varchar("agent_name", { length: 255 }),
    status: mysqlEnum(["pending", "retrying", "sent", "failed_permanent"])
      .default("pending")
      .notNull(),
    retryCount: int("retry_count").default(0).notNull(),
    maxRetries: int("max_retries").default(3).notNull(),
    lastError: text("last_error"),
    errorCode: varchar("error_code", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    nextRetryAt: timestamp("next_retry_at"),
    sentAt: timestamp("sent_at"),
  },
  table => [
    index("evolution_failed_messages_client_id_idx").on(table.clientId),
    index("evolution_failed_messages_status_idx").on(table.status),
    index("evolution_failed_messages_next_retry_idx").on(table.nextRetryAt),
    index("evolution_failed_messages_client_status_idx").on(
      table.clientId,
      table.status
    ),
  ]
);

export const evolutionQueueConfig = mysqlTable(
  "evolution_queue_config",
  {
    configId: varchar("config_id", { length: 255 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    maxRetries: int("max_retries").default(3).notNull(),
    retryDelayMs: int("retry_delay_ms").default(1000).notNull(),
    backoffMultiplier: int("backoff_multiplier").default(2).notNull(),
    maxBackoffMs: int("max_backoff_ms").default(60000).notNull(),
    autoRetryEnabled: int("auto_retry_enabled").default(1).notNull(),
    cleanupAfterDaysSuccess: int("cleanup_after_days_success")
      .default(7)
      .notNull(),
    cleanupAfterDaysFailed: int("cleanup_after_days_failed")
      .default(30)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("evolution_queue_config_client_id_unique").on(table.clientId),
    index("evolution_queue_config_client_id_idx").on(table.clientId),
  ]
);

export const evolutionQueueMetrics = mysqlTable(
  "evolution_queue_metrics",
  {
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
  table => [
    index("evolution_queue_metrics_client_id_idx").on(table.clientId),
    index("evolution_queue_metrics_date_idx").on(table.date),
    index("evolution_queue_metrics_client_date_idx").on(
      table.clientId,
      table.date
    ),
  ]
);

export const evolutionRetryHistory = mysqlTable(
  "evolution_retry_history",
  {
    retryHistoryId: varchar("retry_history_id", { length: 255 })
      .primaryKey()
      .notNull(),
    failedMessageId: varchar("failed_message_id", { length: 255 }).notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    retryNumber: int("retry_number").notNull(),
    status: mysqlEnum(["success", "failed"]).default("failed").notNull(),
    error: text(),
    errorCode: varchar("error_code", { length: 50 }),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    responseTime: int("response_time"),
  },
  table => [
    index("evolution_retry_history_failed_message_id_idx").on(
      table.failedMessageId
    ),
    index("evolution_retry_history_client_id_idx").on(table.clientId),
    index("evolution_retry_history_status_idx").on(table.status),
  ]
);

export const megadeskCompanySettings = mysqlTable(
  "megadesk_company_settings",
  {
    settingId: varchar("setting_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    companyName: varchar("company_name", { length: 255 }),
    logoUrl: text("logo_url"),
    email: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    whatsapp: varchar({ length: 20 }),
    address: text(),
    businessHours: text("business_hours"),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [uniqueIndex("uq_client_settings").on(table.clientId)]
);

export const megadeskDomainAuditLogs = mysqlTable(
  "megadesk_domain_audit_logs",
  {
    auditId: varchar("audit_id", { length: 100 }).primaryKey().notNull(),
    platform: mysqlEnum(["MegaAdmin", "MegaDesk"]).notNull(),
    action: varchar({ length: 255 }).notNull(),
    clientId: varchar("client_id", { length: 80 }),
    success: tinyint().default(1),
    operationId: varchar("operation_id", { length: 36 }),
    operatorUserId: varchar("operator_user_id", { length: 80 }),
    operatorRole: varchar("operator_role", { length: 20 }),
    instanceName: varchar("instance_name", { length: 120 }),
    origin: varchar({ length: 80 }),
    eventPhase: mysqlEnum("event_phase", ["intent", "success", "failure"]),
    errorCode: varchar("error_code", { length: 80 }),
    sourceIp: varchar("source_ip", { length: 45 }),
    metadataJson: json("metadata_json"),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdal_client").on(table.clientId),
    index("idx_mdal_operation").on(table.operationId),
  ]
);

export const megadeskDomainBackups = mysqlTable(
  "megadesk_domain_backups",
  {
    backupId: varchar("backup_id", { length: 80 }).primaryKey().notNull(),
    // you can use { mode: 'date' }, if you want to have Date as type for this column
    backupDate: date("backup_date", { mode: "string" }).notNull(),
    backupTimestamp: timestamp("backup_timestamp", { mode: "string" })
      .defaultNow()
      .notNull(),
    clientsJson: longtext("clients_json").notNull(),
    conversationsJson: longtext("conversations_json").notNull(),
    ticketsJson: longtext("tickets_json").notNull(),
    botScriptsJson: longtext("bot_scripts_json").notNull(),
    operationalRecordsJson: longtext("operational_records_json").notNull(),
    auditLogsJson: longtext("audit_logs_json").notNull(),
    totalClients: int("total_clients").default(0).notNull(),
    totalConversations: int("total_conversations").default(0).notNull(),
    totalTickets: int("total_tickets").default(0).notNull(),
    status: mysqlEnum(["success", "failed", "partial"])
      .default("success")
      .notNull(),
    errorMessage: text("error_message"),
    retentionDays: int("retention_days").default(30).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdb_date").on(table.backupDate),
    index("idx_mdb_timestamp").on(table.backupTimestamp),
  ]
);

export const megadeskDomainBotScripts = mysqlTable(
  "megadesk_domain_bot_scripts",
  {
    scriptId: varchar("script_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    name: varchar({ length: 180 }).notNull(),
    description: text().notNull(),
    systemPrompt: text("system_prompt").notNull(),
    initialMessage: text("initial_message").notNull(),
    active: tinyint().default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [index("idx_mdbs_client").on(table.clientId)]
);

export const megadeskDomainChamadoSequence = mysqlTable(
  "megadesk_domain_chamado_sequence",
  {
    clientId: varchar({ length: 80 }).primaryKey().notNull(),
    nextChamadoNumber: int().default(1).notNull(),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp({ mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  }
);

export const megadeskDomainChamados = mysqlTable(
  "megadesk_domain_chamados",
  {
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
    status: mysqlEnum(["open", "in_progress", "waiting", "closed"]).default(
      "open"
    ),
    priority: mysqlEnum(["baixa", "media", "alta", "critica"]).default("media"),
    assignedTo: varchar({ length: 80 }),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp({ mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdc_client").on(table.clientId),
    index("idx_mdc_status").on(table.status),
    uniqueIndex("uq_chamado_number").on(table.clientId, table.chamadoNumber),
  ]
);

export const megadeskDomainChamadoActivities = mysqlTable(
  "megadesk_domain_chamado_activities",
  {
    activityId: varchar("activity_id", { length: 80 }).primaryKey().notNull(),
    chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    description: text().notNull(),
    attendant: varchar({ length: 180 }).notNull(),
    actionType: mysqlEnum("action_type", [
      "register",
      "edit",
      "close",
      "forward",
      "note",
      "attachment",
    ])
      .default("note")
      .notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdca_chamado").on(table.chamadoId),
    index("idx_mdca_client").on(table.clientId),
  ]
);

export const megadeskDomainChamadoCollaborators = mysqlTable(
  "megadesk_domain_chamado_collaborators",
  {
    collaboratorId: varchar("collaborator_id", { length: 80 })
      .primaryKey()
      .notNull(),
    chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    userName: varchar("user_name", { length: 180 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdcc_chamado").on(table.chamadoId),
    index("idx_mdcc_client").on(table.clientId),
  ]
);

export const megadeskDomainClientUsers = mysqlTable(
  "megadesk_domain_client_users",
  {
    userId: varchar("user_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    name: varchar({ length: 180 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    role: mysqlEnum(["admin", "manager", "agent", "viewer"])
      .default("viewer")
      .notNull(),
    status: mysqlEnum(["active", "blocked"]).default("blocked").notNull(),
    permissionsJson: longtext("permissions_json").notNull(),
    passwordHash: varchar("password_hash", { length: 255 }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdu_client").on(table.clientId),
    uniqueIndex("uq_mdu_client_email").on(table.clientId, table.email),
  ]
);

export const megadeskDomainClients = mysqlTable(
  "megadesk_domain_clients",
  {
    clientId: varchar("client_id", { length: 80 }).primaryKey().notNull(),
    internalId: varchar("internal_id", { length: 80 }).notNull(),
    tenantDatabaseName: varchar("tenant_database_name", {
      length: 120,
    }).notNull(),
    company: varchar({ length: 255 }).notNull(),
    contact: varchar({ length: 180 }).notNull(),
    email: varchar({ length: 255 }),
    phone: varchar({ length: 40 }).notNull(),
    cnpj: varchar({ length: 20 }),
    plan: varchar({ length: 120 }).notNull(),
    maxUsers: int("max_users").default(5).notNull(),
    status: mysqlEnum(["provisioning", "active", "setup", "failed", "paused"])
      .default("provisioning")
      .notNull(),
    statusType: mysqlEnum("status_type", ["active", "test"])
      .default("test")
      .notNull(),
    accessReleased: tinyint("access_released").default(0).notNull(),
    apiToken: varchar("api_token", { length: 255 }).notNull(),
    modulesJson: longtext("modules_json").notNull(),
    integrationsJson: longtext("integrations_json").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("tenant_database_name").on(table.tenantDatabaseName),
    uniqueIndex("uq_mdc_company_email").on(table.email),
    uniqueIndex("uq_mdc_company_document").on(table.cnpj),
  ]
);

export const megadeskDomainConversations = mysqlTable(
  "megadesk_domain_conversations",
  {
    conversationId: varchar("conversation_id", { length: 80 })
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    crmClientId: varchar("crm_client_id", { length: 80 }),
    publicCode: varchar("public_code", { length: 24 }),
    contactId: varchar("contact_id", { length: 80 }),
    origin: mysqlEnum(["inbound", "outbound"]),
    channel: varchar({ length: 40 }),
    provider: varchar({ length: 40 }),
    integrationId: varchar("integration_id", { length: 120 }),
    activeKey: varchar("active_key", { length: 255 }),
    customerName: varchar("customer_name", { length: 180 }).notNull(),
    phone: varchar({ length: 40 }).notNull(),
    company: varchar({ length: 255 }).notNull(),
    status: mysqlEnum(["open", "bot", "closed"]).default("open").notNull(),
    lastMessage: text("last_message").notNull(),
    lastMessageFrom: mysqlEnum("last_message_from", [
      "customer",
      "agent",
      "bot",
    ]),
    timeLabel: varchar("time_label", { length: 80 }).notNull(),
    messagesJson: longtext("messages_json").notNull(),
    unreadCount: int("unread_count").default(0),
    iaActive: tinyint("ia_active").default(0),
    assignedUserId: varchar("assigned_user_id", { length: 80 }),
    assignedUserName: varchar("assigned_user_name", { length: 180 }),
    openedAt: timestamp("opened_at", { mode: "string" }),
    closedAt: timestamp("closed_at", { mode: "string" }),
    closedByUserId: varchar("closed_by_user_id", { length: 80 }),
    reopenedAt: timestamp("reopened_at", { mode: "string" }),
    reopenedByUserId: varchar("reopened_by_user_id", { length: 80 }),
    botSuspendedAt: timestamp("bot_suspended_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdc_client").on(table.clientId),
    index("idx_mdc_status").on(table.status),
    uniqueIndex("uq_mdc_public_code").on(table.publicCode),
    uniqueIndex("uq_mdc_active_key").on(table.activeKey),
    index("idx_mdc_tenant_contact").on(table.clientId, table.contactId),
    index("idx_mdc_tenant_activity").on(table.clientId, table.status, table.updatedAt),
  ]
);

export const megadeskConversationContacts = mysqlTable(
  "megadesk_conversation_contacts",
  {
    contactId: varchar("contact_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 180 }).notNull(),
    canonicalPhone: varchar("canonical_phone", { length: 40 }),
    channel: varchar({ length: 40 }).notNull(),
    provider: varchar({ length: 40 }).notNull(),
    externalIdentity: varchar("external_identity", { length: 180 }).notNull(),
    crmClientId: varchar("crm_client_id", { length: 80 }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("uq_mcc_identity").on(table.clientId, table.channel, table.provider, table.externalIdentity),
    index("idx_mcc_tenant_phone").on(table.clientId, table.canonicalPhone),
    index("idx_mcc_tenant_crm").on(table.clientId, table.crmClientId),
  ]
);

export const megadeskConversationEvents = mysqlTable(
  "megadesk_conversation_events",
  {
    eventId: varchar("event_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    conversationId: varchar("conversation_id", { length: 80 }).notNull(),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    operatorUserId: varchar("operator_user_id", { length: 80 }),
    metadataJson: text("metadata_json").default("{}").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    index("idx_mce_tenant_conversation").on(table.clientId, table.conversationId, table.createdAt),
  ]
);

export const megadeskConversationTickets = mysqlTable(
  "megadesk_conversation_tickets",
  {
    linkId: varchar("link_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    conversationId: varchar("conversation_id", { length: 80 }).notNull(),
    chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
    contactId: varchar("contact_id", { length: 80 }),
    linkedByUserId: varchar("linked_by_user_id", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("uq_mct_tenant_link").on(table.clientId, table.conversationId, table.chamadoId),
    index("idx_mct_tenant_chamado").on(table.clientId, table.chamadoId),
  ]
);

export const megadeskDomainCustomers = mysqlTable(
  "megadesk_domain_customers",
  {
    customerId: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar({ length: 80 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    company: varchar({ length: 255 }),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp({ mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdc_client").on(table.clientId),
    index("idx_mdc_phone").on(table.phone),
    uniqueIndex("uq_mdc_tenant_phone").on(table.clientId, table.phone),
    uniqueIndex("uq_mdc_tenant_email").on(table.clientId, table.email),
  ]
);

export const megadeskDomainMetrics = mysqlTable(
  "megadesk_domain_metrics",
  {
    metricId: bigint("metric_id", { mode: "number" })
      .autoincrement()
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    metricType: varchar("metric_type", { length: 80 }).notNull(),
    amount: int().default(1).notNull(),
    source: varchar({ length: 80 }).default("system").notNull(),
    metadataJson: longtext("metadata_json").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [index("idx_mdm_client").on(table.clientId)]
);

export const megadeskDomainOperationalRecords = mysqlTable(
  "megadesk_domain_operational_records",
  {
    recordId: varchar("record_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    tenantDatabaseName: varchar("tenant_database_name", {
      length: 120,
    }).notNull(),
    recordType: mysqlEnum("record_type", [
      "conversation",
      "ticket",
      "tracking",
      "erp",
    ]).notNull(),
    ownerPhone: varchar("owner_phone", { length: 40 }).notNull(),
    title: varchar({ length: 255 }).notNull(),
    status: varchar({ length: 80 }).notNull(),
    payloadJson: longtext("payload_json").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdor_client").on(table.clientId),
    index("idx_mdor_tenant").on(table.tenantDatabaseName),
  ]
);

export const megadeskDomainTickets = mysqlTable(
  "megadesk_domain_tickets",
  {
    ticketId: varchar("ticket_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    company: varchar({ length: 255 }).notNull(),
    customer: varchar({ length: 180 }).notNull(),
    problem: varchar({ length: 255 }).notNull(),
    category: varchar({ length: 120 }).notNull(),
    status: mysqlEnum(["open", "in_progress", "waiting", "closed"])
      .default("open")
      .notNull(),
    createdLabel: varchar("created_label", { length: 80 }).notNull(),
    description: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [index("idx_mdt_client").on(table.clientId)]
);

export const megadeskWhatsappConfig = mysqlTable(
  "megadesk_whatsapp_config",
  {
    configId: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar({ length: 80 }).notNull(),
    phoneNumberId: varchar({ length: 255 }),
    businessAccountId: varchar({ length: 255 }),
    accessToken: varchar({ length: 500 }),
    webhookVerifyToken: varchar({ length: 255 }),
    phoneNumber: varchar({ length: 20 }),
    webhookUrl: varchar({ length: 500 }),
    connectionStatus: tinyint().default(0),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp({ mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [uniqueIndex("uq_client_whatsapp").on(table.clientId)]
);

export const users = mysqlTable(
  "users",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    openId: varchar("open_id", { length: 255 }).notNull(),
    name: varchar({ length: 255 }).default("Usuário MegaDesk").notNull(),
    email: varchar({ length: 255 }),
    loginMethod: varchar("login_method", { length: 64 }),
    role: mysqlEnum(["admin", "user"]).default("user").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
    lastSignedIn: timestamp("last_signed_in", { mode: "string" }),
  },
  table => [
    uniqueIndex("users_open_id_unique").on(table.openId),
    index("users_email").on(table.email),
  ]
);

export const waAccounts = mysqlTable(
  "wa_accounts",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 180 }).default("").notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 80 }).notNull(),
    businessAccountId: varchar("business_account_id", { length: 80 }).notNull(),
    accessToken: text("access_token").notNull(),
    webhookVerifyToken: varchar("webhook_verify_token", {
      length: 120,
    }).notNull(),
    status: mysqlEnum(["active", "inactive", "error"])
      .default("inactive")
      .notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_wa_accounts_client").on(table.clientId),
    index("idx_wa_accounts_phone").on(table.phoneNumberId),
  ]
);

export const megadeskOperationalSessions = mysqlTable(
  "megadesk_operational_sessions",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    sessionVersion: int("session_version").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { mode: "string" }),
  },
  table => [
    uniqueIndex("uq_mos_token_hash").on(table.tokenHash),
    index("idx_mos_user").on(table.userId),
    index("idx_mos_client").on(table.clientId),
    index("idx_mos_expires").on(table.expiresAt),
  ]
);

export const megadeskTenantProvisioningRequests = mysqlTable(
  "megadesk_tenant_provisioning_requests",
  {
    idempotencyKey: varchar("idempotency_key", { length: 120 })
      .primaryKey()
      .notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [index("idx_mtpr_client").on(table.clientId)]
);

export const megadeskTicketStatuses = mysqlTable(
  "megadesk_ticket_statuses",
  {
    statusId: varchar("status_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    color: varchar({ length: 7 }).default("#3b82f6").notNull(),
    order: int().default(0).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mts_client").on(table.clientId),
    uniqueIndex("uq_mts_client_name").on(table.clientId, table.name),
  ]
);

export const megadeskCrmTimeline = mysqlTable(
  "megadesk_crm_timeline",
  {
    timelineId: varchar("timeline_id", { length: 80 }).primaryKey().notNull(),
    crmClientId: varchar("crm_client_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    entryType: varchar("entry_type", { length: 80 }).notNull(),
    description: text().notNull(),
    author: varchar({ length: 180 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mct_tenant_client").on(table.clientId, table.crmClientId),
  ]
);

export const megadeskConversationMessages = mysqlTable(
  "megadesk_domain_conversations_messages",
  {
    messageId: varchar("message_id", { length: 100 }).primaryKey().notNull(),
    conversationId: varchar("conversation_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }),
    externalMessageId: varchar("external_message_id", { length: 180 }),
    provider: varchar({ length: 40 }),
    integrationId: varchar("integration_id", { length: 120 }),
    clientAttemptId: varchar("client_attempt_id", { length: 80 }),
    direction: mysqlEnum(["inbound", "outbound", "system"]),
    messageType: varchar("message_type", { length: 40 }),
    senderUserId: varchar("sender_user_id", { length: 80 }),
    senderNameSnapshot: varchar("sender_name_snapshot", { length: 180 }),
    mediaReference: longtext("media_reference"),
    sender: varchar({ length: 180 }).notNull(),
    message: text().notNull(),
    timestamp: timestamp({ mode: "string" }).defaultNow().notNull(),
    status: varchar({ length: 40 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdcm_conversation").on(table.conversationId),
    index("idx_mdcm_tenant_conversation").on(table.clientId, table.conversationId, table.timestamp),
    uniqueIndex("uq_mdcm_external").on(table.clientId, table.provider, table.integrationId, table.externalMessageId),
    uniqueIndex("uq_mdcm_client_attempt").on(table.clientId, table.clientAttemptId),
  ]
);

export const megadeskEvolutionSessions = mysqlTable(
  "megadesk_evolution_sessions",
  {
    clientId: varchar("client_id", { length: 80 }).primaryKey().notNull(),
    instanceName: varchar("instance_name", { length: 120 }).notNull(),
    status: mysqlEnum(["disconnected", "connecting", "connected"])
      .default("disconnected")
      .notNull(),
    phoneNumber: varchar("phone_number", { length: 30 }),
    connectedAt: timestamp("connected_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [uniqueIndex("uq_evo_instance").on(table.instanceName)]
);

export const megadeskIaConversationHistory = mysqlTable(
  "megadesk_domain_ia_conversation_history",
  {
    historyId: varchar("history_id", { length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    messagesJson: text("messages_json").notNull(),
    contextJson: text("context_json").default("{}").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mdich_client").on(table.clientId),
    index("idx_mdich_user").on(table.userId),
    uniqueIndex("uq_mdich_user_client").on(table.userId, table.clientId),
  ]
);

export const megadeskIaConversations = mysqlTable(
  "megadesk_domain_ia_conversations",
  {
    conversationId: varchar("conversation_id", { length: 80 })
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    userMessage: text("user_message").notNull(),
    iaResponse: text("ia_response").notNull(),
    tokensUsed: int("tokens_used").default(0).notNull(),
    tipo: mysqlEnum(["consulta", "relatorio", "acao", "analise"])
      .default("consulta")
      .notNull(),
    status: mysqlEnum(["sucesso", "erro", "pendente"])
      .default("sucesso")
      .notNull(),
    errorMessage: text("error_message"),
    metadataJson: text("metadata_json").default("{}").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdic_client").on(table.clientId),
    index("idx_mdic_user").on(table.userId),
    index("idx_mdic_created_at").on(table.createdAt),
  ]
);

export const megadeskIaTokenUsage = mysqlTable(
  "megadesk_ia_token_usage",
  {
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
  },
  table => [
    index("idx_mitu_client_created").on(table.clientId, table.createdAt),
    index("idx_mitu_client_user").on(table.clientId, table.userEmail),
  ]
);

export const waConversations = mysqlTable(
  "wa_conversations",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    accountId: varchar("account_id", { length: 80 }).notNull(),
    customerName: varchar("customer_name", { length: 180 })
      .default("")
      .notNull(),
    customerPhone: varchar("customer_phone", { length: 40 }).notNull(),
    lastMessage: text("last_message").default("").notNull(),
    lastMessageAt: timestamp("last_message_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    unreadCount: int("unread_count").default(0).notNull(),
    status: mysqlEnum(["open", "pending", "closed"]).default("open").notNull(),
    assignedUserId: varchar("assigned_user_id", { length: 80 }),
    crmClientId: varchar("crm_client_id", { length: 80 }),
    metadataJson: text("metadata_json").default("{}").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_wa_conv_client").on(table.clientId),
    index("idx_wa_conv_account").on(table.accountId),
    index("idx_wa_conv_phone").on(table.customerPhone),
    index("idx_wa_conv_status").on(table.status),
    index("idx_wa_conv_last_msg").on(table.lastMessageAt),
  ]
);

export const waMessages = mysqlTable(
  "wa_messages",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    conversationId: varchar("conversation_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    waMessageId: varchar("wa_message_id", { length: 120 }),
    senderType: mysqlEnum(["customer", "agent", "bot"]).notNull(),
    messageType: mysqlEnum([
      "text",
      "image",
      "audio",
      "video",
      "document",
      "template",
      "sticker",
      "location",
      "reaction",
    ])
      .default("text")
      .notNull(),
    content: text().default("").notNull(),
    mediaUrl: text("media_url"),
    mediaId: varchar("media_id", { length: 120 }),
    caption: text(),
    status: mysqlEnum(["pending", "sent", "delivered", "read", "failed"])
      .default("pending")
      .notNull(),
    errorMessage: text("error_message"),
    metadataJson: text("metadata_json").default("{}").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_wa_msg_conv").on(table.conversationId),
    index("idx_wa_msg_client").on(table.clientId),
    index("idx_wa_msg_wa_id").on(table.waMessageId),
    index("idx_wa_msg_created").on(table.createdAt),
    uniqueIndex("uq_wa_msg_client_external").on(
      table.clientId,
      table.waMessageId
    ),
  ]
);

export const megadeskNotifications = mysqlTable(
  "megadesk_notifications",
  {
    notificationId: varchar("notification_id", { length: 80 })
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    title: varchar({ length: 255 }).notNull(),
    message: text().notNull(),
    type: mysqlEnum(["info", "success", "warning", "error", "system"])
      .default("info")
      .notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    actionUrl: varchar("action_url", { length: 500 }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    readAt: timestamp("read_at", { mode: "string" }),
  },
  table => [
    index("idx_mn_client").on(table.clientId),
    index("idx_mn_user").on(table.userId),
    index("idx_mn_client_user").on(table.clientId, table.userId),
    index("idx_mn_is_read").on(table.isRead),
    index("idx_mn_created_at").on(table.createdAt),
  ]
);

export const adminCredentials = mysqlTable(
  "admin_credentials",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    active: tinyint().default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_admin_client").on(table.clientId),
    index("idx_admin_email").on(table.email),
    uniqueIndex("uq_admin_client_email").on(table.clientId, table.email),
  ]
);

// ─── Tabelas adicionais (Chamados, CRM) ──────────────────────────────────────

export const megadeskDomainChamadoAttachments = mysqlTable(
  "megadesk_domain_chamado_attachments",
  {
    attachmentId: varchar("attachment_id", { length: 80 })
      .primaryKey()
      .notNull(),
    chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: int("file_size"),
    mimeType: varchar("mime_type", { length: 100 }),
    uploadedBy: varchar("uploaded_by", { length: 180 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_mdca_att_chamado").on(table.chamadoId),
    index("idx_mdca_att_client").on(table.clientId),
  ]
);

export const megadeskCrmClients = mysqlTable(
  "megadesk_crm_clients",
  {
    crmClientId: varchar("crm_client_id", { length: 80 })
      .primaryKey()
      .notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    customerType: mysqlEnum("customer_type", ["person", "company"]),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    responsibleName: varchar("responsible_name", { length: 180 })
      .default("")
      .notNull(),
    cpfCnpj: varchar("cpf_cnpj", { length: 20 }),
    phone: varchar({ length: 40 }),
    whatsapp: varchar({ length: 40 }).default("").notNull(),
    email: varchar({ length: 255 }),
    address: varchar({ length: 255 }).default("").notNull(),
    city: varchar({ length: 120 }).default("").notNull(),
    state: varchar({ length: 2 }).default("").notNull(),
    cep: varchar({ length: 10 }).default("").notNull(),
    status: mysqlEnum(["lead", "ativo", "inativo", "cancelado", "inadimplente"])
      .default("lead")
      .notNull(),
    origin: mysqlEnum([
      "whatsapp",
      "instagram",
      "facebook",
      "site",
      "indicacao",
      "outro",
    ])
      .default("outro")
      .notNull(),
    internalResponsible: varchar("internal_responsible", { length: 180 })
      .default("")
      .notNull(),
    tags: text().default("").notNull(),
    observations: text().default("").notNull(),
    contactsJson: text("contacts_json"),
    lastInteractionAt: timestamp("last_interaction_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mcc_client").on(table.clientId),
    index("idx_mcc_status").on(table.status),
    index("idx_mcc_company").on(table.companyName),
    index("idx_mcc_phone").on(table.phone),
    uniqueIndex("uq_mcc_tenant_document").on(table.clientId, table.cpfCnpj),
    uniqueIndex("uq_mcc_tenant_phone").on(table.clientId, table.phone),
    uniqueIndex("uq_mcc_tenant_email").on(table.clientId, table.email),
  ]
);

export const megaadminCredentials = mysqlTable(
  "megaadmin_credentials",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    email: varchar({ length: 255 }).notNull(),
    name: varchar({ length: 255 }).default("Administrador").notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    active: tinyint().default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [uniqueIndex("megaadmin_email").on(table.email)]
);

// ─── User Settings e Shortcuts ───────────────────────────────────────────────

export const megadeskUserSettings = mysqlTable(
  "megadesk_user_settings",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    notificationsEnabled: tinyint("notifications_enabled").default(1).notNull(),
    soundEnabled: tinyint("sound_enabled").default(1).notNull(),
    soundVolume: int("sound_volume").default(70).notNull(),
    muteUntil: timestamp("mute_until", { mode: "string" }),
    desktopNotificationsEnabled: tinyint("desktop_notifications_enabled")
      .default(1)
      .notNull(),
    whatsappNotificationsEnabled: tinyint("whatsapp_notifications_enabled")
      .default(1)
      .notNull(),
    ticketsNotificationsEnabled: tinyint("tickets_notifications_enabled")
      .default(1)
      .notNull(),
    iaNotificationsEnabled: tinyint("ia_notifications_enabled")
      .default(1)
      .notNull(),
    showMessagePreview: tinyint("show_message_preview").default(1).notNull(),
    autoResponseEnabled: tinyint("auto_response_enabled").default(0).notNull(),
    autoResponseMessage: text("auto_response_message"),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [uniqueIndex("idx_mus_client_user").on(table.clientId, table.userId)]
);

export const megadeskUserShortcuts = mysqlTable(
  "megadesk_user_shortcuts",
  {
    id: varchar({ length: 80 }).primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    userId: varchar("user_id", { length: 80 }).notNull(),
    shortcutKey: varchar("shortcut_key", { length: 50 }).notNull(),
    shortcutMessage: text("shortcut_message").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    index("idx_mush_client_user").on(table.clientId, table.userId),
    uniqueIndex("uq_mush_client_user_key").on(
      table.clientId,
      table.userId,
      table.shortcutKey
    ),
  ]
);

export const erpProducts = mysqlTable(
  "erp_products",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    name: varchar({ length: 180 }).notNull(),
    sku: varchar({ length: 80 }).notNull(),
    barcode: varchar({ length: 80 }),
    description: text(),
    category: varchar({ length: 120 }),
    unit: mysqlEnum(["unit", "kg", "liter", "meter"]).notNull(),
    costPriceCents: bigint("cost_price_cents", { mode: "number" })
      .default(0)
      .notNull(),
    salePriceCents: bigint("sale_price_cents", { mode: "number" })
      .default(0)
      .notNull(),
    minimumStock: decimal("minimum_stock", { precision: 18, scale: 3 })
      .default("0.000")
      .notNull(),
    active: tinyint().default(1).notNull(),
    createdBy: varchar("created_by", { length: 80 }).notNull(),
    updatedBy: varchar("updated_by", { length: 80 }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_products_tenant_public").on(
      table.clientId,
      table.publicId
    ),
    uniqueIndex("uq_erp_products_tenant_sku").on(table.clientId, table.sku),
    uniqueIndex("uq_erp_products_tenant_barcode").on(
      table.clientId,
      table.barcode
    ),
    index("idx_erp_products_tenant_name").on(table.clientId, table.name),
    index("idx_erp_products_tenant_active").on(table.clientId, table.active),
  ]
);

export const erpStockBalances = mysqlTable(
  "erp_stock_balances",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    productId: bigint("product_id", { mode: "number" }).notNull(),
    quantity: decimal({ precision: 18, scale: 3 }).default("0.000").notNull(),
    version: int().default(0).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_stock_balance_tenant_product").on(
      table.clientId,
      table.productId
    ),
    index("idx_erp_stock_balance_tenant").on(table.clientId),
  ]
);

export const erpStockMovements = mysqlTable(
  "erp_stock_movements",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    productId: bigint("product_id", { mode: "number" }).notNull(),
    type: mysqlEnum([
      "initial",
      "manual_in",
      "manual_out",
      "adjustment_in",
      "adjustment_out",
      "purchase_in",
      "sale_out",
      "reversal",
    ]).notNull(),
    direction: mysqlEnum(["in", "out"]).notNull(),
    quantity: decimal({ precision: 18, scale: 3 }).notNull(),
    previousBalance: decimal("previous_balance", {
      precision: 18,
      scale: 3,
    }).notNull(),
    resultingBalance: decimal("resulting_balance", {
      precision: 18,
      scale: 3,
    }).notNull(),
    reason: varchar({ length: 500 }).notNull(),
    referenceType: mysqlEnum("reference_type", [
      "manual",
      "purchase",
      "sale",
      "purchase_reversal",
      "sale_reversal",
      "movement",
    ]),
    referenceId: varchar("reference_id", { length: 80 }),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    reversalOf: bigint("reversal_of", { mode: "number" }),
    createdBy: varchar("created_by", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_stock_movement_tenant_public").on(
      table.clientId,
      table.publicId
    ),
    uniqueIndex("uq_erp_stock_movement_tenant_idempotency").on(
      table.clientId,
      table.idempotencyKey
    ),
    uniqueIndex("uq_erp_stock_movement_tenant_reversal").on(
      table.clientId,
      table.reversalOf
    ),
    index("idx_erp_stock_movement_tenant_product_date").on(
      table.clientId,
      table.productId,
      table.createdAt
    ),
    index("idx_erp_stock_movement_tenant_date").on(
      table.clientId,
      table.createdAt
    ),
  ]
);

export const erpSuppliers = mysqlTable(
  "erp_suppliers",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    legalName: varchar("legal_name", { length: 180 }).notNull(),
    tradeName: varchar("trade_name", { length: 180 }),
    personType: mysqlEnum("person_type", ["legal", "individual"]).notNull(),
    taxId: varchar("tax_id", { length: 14 }),
    stateRegistration: varchar("state_registration", { length: 40 }),
    email: varchar({ length: 254 }),
    phone: varchar({ length: 30 }),
    contactName: varchar("contact_name", { length: 120 }),
    postalCode: varchar("postal_code", { length: 8 }),
    street: varchar({ length: 180 }),
    addressNumber: varchar("address_number", { length: 30 }),
    addressComplement: varchar("address_complement", { length: 120 }),
    district: varchar({ length: 120 }),
    city: varchar({ length: 120 }),
    state: varchar({ length: 2 }),
    notes: text(),
    active: tinyint().default(1).notNull(),
    createdBy: varchar("created_by", { length: 80 }).notNull(),
    updatedBy: varchar("updated_by", { length: 80 }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_suppliers_tenant_public").on(
      table.clientId,
      table.publicId
    ),
    uniqueIndex("uq_erp_suppliers_tenant_tax_id").on(
      table.clientId,
      table.taxId
    ),
    index("idx_erp_suppliers_tenant_legal_name").on(
      table.clientId,
      table.legalName
    ),
    index("idx_erp_suppliers_tenant_active").on(table.clientId, table.active),
    index("idx_erp_suppliers_tenant_city_state").on(
      table.clientId,
      table.city,
      table.state
    ),
  ]
);

export const erpPurchaseOrderSequences = mysqlTable(
  "erp_purchase_order_sequences",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    year: int().notNull(),
    nextNumber: int("next_number").default(1).notNull(),
  },
  table => [
    uniqueIndex("uq_erp_purchase_sequence_tenant_year").on(
      table.clientId,
      table.year
    ),
  ]
);

export const erpPurchaseOrders = mysqlTable(
  "erp_purchase_orders",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    orderNumber: varchar("order_number", { length: 32 }).notNull(),
    supplierId: bigint("supplier_id", { mode: "number" }).notNull(),
    supplierNameSnapshot: varchar("supplier_name_snapshot", {
      length: 180,
    }).notNull(),
    status: mysqlEnum(["draft", "approved", "received", "cancelled"])
      .default("draft")
      .notNull(),
    notes: text(),
    expectedDate: date("expected_date", { mode: "string" }),
    subtotalCents: bigint("subtotal_cents", { mode: "number" })
      .default(0)
      .notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).default(0).notNull(),
    approvedBy: varchar("approved_by", { length: 80 }),
    approvedAt: timestamp("approved_at", { mode: "string" }),
    receivedBy: varchar("received_by", { length: 80 }),
    receivedAt: timestamp("received_at", { mode: "string" }),
    cancelledBy: varchar("cancelled_by", { length: 80 }),
    cancelledAt: timestamp("cancelled_at", { mode: "string" }),
    cancellationReason: varchar("cancellation_reason", { length: 500 }),
    createdBy: varchar("created_by", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_purchase_orders_tenant_public").on(
      table.clientId,
      table.publicId
    ),
    uniqueIndex("uq_erp_purchase_orders_tenant_number").on(
      table.clientId,
      table.orderNumber
    ),
    index("idx_erp_purchase_orders_tenant_status_date").on(
      table.clientId,
      table.status,
      table.createdAt
    ),
    index("idx_erp_purchase_orders_tenant_supplier").on(
      table.clientId,
      table.supplierId
    ),
    foreignKey({
      name: "fk_erp_po_supplier",
      columns: [table.supplierId],
      foreignColumns: [erpSuppliers.id],
    }),
  ]
);

export const erpPurchaseOrderItems = mysqlTable(
  "erp_purchase_order_items",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull(),
    productId: bigint("product_id", { mode: "number" }).notNull(),
    productNameSnapshot: varchar("product_name_snapshot", {
      length: 180,
    }).notNull(),
    skuSnapshot: varchar("sku_snapshot", { length: 80 }).notNull(),
    quantity: decimal({ precision: 18, scale: 3 }).notNull(),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_purchase_items_order_public").on(
      table.purchaseOrderId,
      table.publicId
    ),
    uniqueIndex("uq_erp_purchase_items_order_product").on(
      table.purchaseOrderId,
      table.productId
    ),
    foreignKey({
      name: "fk_erp_poi_order",
      columns: [table.purchaseOrderId],
      foreignColumns: [erpPurchaseOrders.id],
    }),
    foreignKey({
      name: "fk_erp_poi_product",
      columns: [table.productId],
      foreignColumns: [erpProducts.id],
    }),
  ]
);

export const erpPurchaseOrderHistory = mysqlTable(
  "erp_purchase_order_history",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull(),
    fromStatus: mysqlEnum("from_status", [
      "draft",
      "approved",
      "received",
      "cancelled",
    ]),
    toStatus: mysqlEnum("to_status", [
      "draft",
      "approved",
      "received",
      "cancelled",
    ]).notNull(),
    reason: varchar({ length: 500 }),
    changedBy: varchar("changed_by", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("idx_erp_purchase_history_order_date").on(
      table.purchaseOrderId,
      table.createdAt
    ),
    foreignKey({
      name: "fk_erp_poh_order",
      columns: [table.purchaseOrderId],
      foreignColumns: [erpPurchaseOrders.id],
    }),
  ]
);

export const erpPurchaseOrderReceipts = mysqlTable(
  "erp_purchase_order_receipts",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    publicId: varchar("public_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 80 }).notNull(),
    purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    receivedBy: varchar("received_by", { length: 80 }).notNull(),
    receivedAt: timestamp("received_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_purchase_receipts_tenant_public").on(
      table.clientId,
      table.publicId
    ),
    uniqueIndex("uq_erp_purchase_receipts_tenant_idempotency").on(
      table.clientId,
      table.idempotencyKey
    ),
    uniqueIndex("uq_erp_purchase_receipts_order").on(table.purchaseOrderId),
    foreignKey({
      name: "fk_erp_por_order",
      columns: [table.purchaseOrderId],
      foreignColumns: [erpPurchaseOrders.id],
    }),
  ]
);

export const erpPurchaseOrderReceiptItems = mysqlTable(
  "erp_purchase_order_receipt_items",
  {
    id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
    receiptId: bigint("receipt_id", { mode: "number" }).notNull(),
    purchaseOrderItemId: bigint("purchase_order_item_id", {
      mode: "number",
    }).notNull(),
    productId: bigint("product_id", { mode: "number" }).notNull(),
    quantity: decimal({ precision: 18, scale: 3 }).notNull(),
    stockMovementId: bigint("stock_movement_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("uq_erp_purchase_receipt_items_receipt_order_item").on(
      table.receiptId,
      table.purchaseOrderItemId
    ),
    uniqueIndex("uq_erp_purchase_receipt_items_stock_movement").on(
      table.stockMovementId
    ),
    foreignKey({
      name: "fk_erp_pori_receipt",
      columns: [table.receiptId],
      foreignColumns: [erpPurchaseOrderReceipts.id],
    }),
    foreignKey({
      name: "fk_erp_pori_order_item",
      columns: [table.purchaseOrderItemId],
      foreignColumns: [erpPurchaseOrderItems.id],
    }),
    foreignKey({
      name: "fk_erp_pori_product",
      columns: [table.productId],
      foreignColumns: [erpProducts.id],
    }),
    foreignKey({
      name: "fk_erp_pori_movement",
      columns: [table.stockMovementId],
      foreignColumns: [erpStockMovements.id],
    }),
  ]
);

export const erpSaleOrderSequences = mysqlTable("erp_sale_order_sequences", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  year: int().notNull(),
  nextNumber: int("next_number").default(1).notNull(),
}, table => [uniqueIndex("uq_erp_sale_sequence_tenant_year").on(table.clientId, table.year)]);

export const erpSaleOrders = mysqlTable("erp_sale_orders", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  publicId: varchar("public_id", { length: 36 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  orderNumber: varchar("order_number", { length: 32 }).notNull(),
  crmClientId: varchar("crm_client_id", { length: 80 }).notNull(),
  customerNameSnapshot: varchar("customer_name_snapshot", { length: 255 }).notNull(),
  status: mysqlEnum(["draft", "confirmed", "fulfilled", "cancelled"]).default("draft").notNull(),
  notes: text(),
  expectedDate: date("expected_date", { mode: "string" }),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).default(0).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).default(0).notNull(),
  confirmedBy: varchar("confirmed_by", { length: 80 }),
  confirmedAt: timestamp("confirmed_at", { mode: "string" }),
  fulfilledBy: varchar("fulfilled_by", { length: 80 }),
  fulfilledAt: timestamp("fulfilled_at", { mode: "string" }),
  cancelledBy: varchar("cancelled_by", { length: 80 }),
  cancelledAt: timestamp("cancelled_at", { mode: "string" }),
  cancellationReason: varchar("cancellation_reason", { length: 500 }),
  createdBy: varchar("created_by", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("uq_erp_sale_orders_tenant_public").on(table.clientId, table.publicId),
  uniqueIndex("uq_erp_sale_orders_tenant_number").on(table.clientId, table.orderNumber),
  index("idx_erp_sale_orders_tenant_status_date").on(table.clientId, table.status, table.createdAt),
  index("idx_erp_sale_orders_tenant_customer").on(table.clientId, table.crmClientId),
  foreignKey({ name: "fk_erp_so_customer", columns: [table.crmClientId], foreignColumns: [megadeskCrmClients.crmClientId] }),
]);

export const erpSaleOrderItems = mysqlTable("erp_sale_order_items", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  publicId: varchar("public_id", { length: 36 }).notNull(),
  saleOrderId: bigint("sale_order_id", { mode: "number" }).notNull(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  productNameSnapshot: varchar("product_name_snapshot", { length: 180 }).notNull(),
  skuSnapshot: varchar("sku_snapshot", { length: 80 }).notNull(),
  quantity: decimal({ precision: 18, scale: 3 }).notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("uq_erp_sale_items_order_public").on(table.saleOrderId, table.publicId),
  uniqueIndex("uq_erp_sale_items_order_product").on(table.saleOrderId, table.productId),
  foreignKey({ name: "fk_erp_soi_order", columns: [table.saleOrderId], foreignColumns: [erpSaleOrders.id] }),
  foreignKey({ name: "fk_erp_soi_product", columns: [table.productId], foreignColumns: [erpProducts.id] }),
]);

export const erpSaleOrderHistory = mysqlTable("erp_sale_order_history", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  saleOrderId: bigint("sale_order_id", { mode: "number" }).notNull(),
  fromStatus: mysqlEnum("from_status", ["draft", "confirmed", "fulfilled", "cancelled"]),
  toStatus: mysqlEnum("to_status", ["draft", "confirmed", "fulfilled", "cancelled"]).notNull(),
  reason: varchar({ length: 500 }),
  changedBy: varchar("changed_by", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, table => [
  index("idx_erp_sale_history_order_date").on(table.saleOrderId, table.createdAt),
  foreignKey({ name: "fk_erp_soh_order", columns: [table.saleOrderId], foreignColumns: [erpSaleOrders.id] }),
]);

export const erpSaleOrderFulfillments = mysqlTable("erp_sale_order_fulfillments", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  publicId: varchar("public_id", { length: 36 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  saleOrderId: bigint("sale_order_id", { mode: "number" }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  fulfilledBy: varchar("fulfilled_by", { length: 80 }).notNull(),
  fulfilledAt: timestamp("fulfilled_at", { mode: "string" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("uq_erp_sale_fulfillments_tenant_public").on(table.clientId, table.publicId),
  uniqueIndex("uq_erp_sale_fulfillments_tenant_idempotency").on(table.clientId, table.idempotencyKey),
  uniqueIndex("uq_erp_sale_fulfillments_order").on(table.saleOrderId),
  foreignKey({ name: "fk_erp_sof_order", columns: [table.saleOrderId], foreignColumns: [erpSaleOrders.id] }),
]);

export const erpSaleOrderFulfillmentItems = mysqlTable("erp_sale_order_fulfillment_items", {
  id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
  fulfillmentId: bigint("fulfillment_id", { mode: "number" }).notNull(),
  saleOrderItemId: bigint("sale_order_item_id", { mode: "number" }).notNull(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  quantity: decimal({ precision: 18, scale: 3 }).notNull(),
  stockMovementId: bigint("stock_movement_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, table => [
  uniqueIndex("uq_erp_sale_fulfillment_item_order_item").on(table.fulfillmentId, table.saleOrderItemId),
  uniqueIndex("uq_erp_sale_fulfillment_item_movement").on(table.stockMovementId),
  foreignKey({ name: "fk_erp_sofi_fulfillment", columns: [table.fulfillmentId], foreignColumns: [erpSaleOrderFulfillments.id] }),
  foreignKey({ name: "fk_erp_sofi_order_item", columns: [table.saleOrderItemId], foreignColumns: [erpSaleOrderItems.id] }),
  foreignKey({ name: "fk_erp_sofi_product", columns: [table.productId], foreignColumns: [erpProducts.id] }),
  foreignKey({ name: "fk_erp_sofi_movement", columns: [table.stockMovementId], foreignColumns: [erpStockMovements.id] }),
]);

export const erpFinancialAccounts = mysqlTable("erp_financial_accounts", {
  id: bigint({mode:"number"}).autoincrement().primaryKey().notNull(), publicId:varchar("public_id",{length:36}).notNull(), clientId:varchar("client_id",{length:80}).notNull(),
  name:varchar({length:180}).notNull(), type:mysqlEnum(["cash","bank"]).notNull(), initialBalanceCents:bigint("initial_balance_cents",{mode:"number"}).notNull(), currentBalanceCents:bigint("current_balance_cents",{mode:"number"}).notNull(),
  allowNegative:boolean("allow_negative").default(false).notNull(), active:boolean().default(true).notNull(), createdBy:varchar("created_by",{length:80}).notNull(),
  createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fin_accounts_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fin_accounts_tenant_name").on(t.clientId,t.name),index("idx_erp_fin_accounts_tenant_active").on(t.clientId,t.active)]);

export const erpFinancialCategories = mysqlTable("erp_financial_categories", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),name:varchar({length:180}).notNull(),
  direction:mysqlEnum(["payable","receivable","both"]).notNull(),active:boolean().default(true).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fin_categories_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fin_categories_tenant_name").on(t.clientId,t.name),index("idx_erp_fin_categories_tenant_active").on(t.clientId,t.active)]);

export const erpFinancialEntries = mysqlTable("erp_financial_entries", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),documentNumber:varchar("document_number",{length:80}).notNull(),
  direction:mysqlEnum(["payable","receivable"]).notNull(),status:mysqlEnum(["open","settled","cancelled"]).default("open").notNull(),description:varchar({length:500}).notNull(),amountCents:bigint("amount_cents",{mode:"number"}).notNull(),
  dueDate:date("due_date",{mode:"string"}).notNull(),issueDate:date("issue_date",{mode:"string"}).notNull(),categoryId:bigint("category_id",{mode:"number"}).notNull(),financialAccountId:bigint("financial_account_id",{mode:"number"}),
  supplierId:bigint("supplier_id",{mode:"number"}),crmClientId:varchar("crm_client_id",{length:80}),sourceType:mysqlEnum("source_type",["manual","purchase_order","sales_order"]).notNull(),sourcePublicId:varchar("source_public_id",{length:36}),
  partyNameSnapshot:varchar("party_name_snapshot",{length:255}),notes:text(),settledAt:timestamp("settled_at",{mode:"string"}),settledBy:varchar("settled_by",{length:80}),cancelledAt:timestamp("cancelled_at",{mode:"string"}),cancelledBy:varchar("cancelled_by",{length:80}),cancellationReason:varchar("cancellation_reason",{length:500}),createdBy:varchar("created_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fin_entries_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fin_entries_tenant_source").on(t.clientId,t.sourceType,t.sourcePublicId),index("idx_erp_fin_entries_tenant_status_due").on(t.clientId,t.status,t.dueDate),index("idx_erp_fin_entries_tenant_direction_issue").on(t.clientId,t.direction,t.issueDate),foreignKey({name:"fk_erp_fin_entry_category",columns:[t.categoryId],foreignColumns:[erpFinancialCategories.id]}),foreignKey({name:"fk_erp_fin_entry_account",columns:[t.financialAccountId],foreignColumns:[erpFinancialAccounts.id]}),foreignKey({name:"fk_erp_fin_entry_supplier",columns:[t.supplierId],foreignColumns:[erpSuppliers.id]})]);

export const erpFinancialSettlements = mysqlTable("erp_financial_settlements", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),financialEntryId:bigint("financial_entry_id",{mode:"number"}).notNull(),financialAccountId:bigint("financial_account_id",{mode:"number"}).notNull(),idempotencyKey:varchar("idempotency_key",{length:100}).notNull(),amountCents:bigint("amount_cents",{mode:"number"}).notNull(),settledBy:varchar("settled_by",{length:80}).notNull(),settledAt:timestamp("settled_at",{mode:"string"}).defaultNow().notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fin_settlements_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fin_settlements_tenant_entry").on(t.clientId,t.financialEntryId),uniqueIndex("uq_erp_fin_settlements_tenant_key").on(t.clientId,t.idempotencyKey),foreignKey({name:"fk_erp_fin_settlement_entry",columns:[t.financialEntryId],foreignColumns:[erpFinancialEntries.id]}),foreignKey({name:"fk_erp_fin_settlement_account",columns:[t.financialAccountId],foreignColumns:[erpFinancialAccounts.id]})]);

export const erpFinancialLedger = mysqlTable("erp_financial_ledger", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),financialAccountId:bigint("financial_account_id",{mode:"number"}).notNull(),financialEntryId:bigint("financial_entry_id",{mode:"number"}),settlementId:bigint("settlement_id",{mode:"number"}),type:mysqlEnum(["opening_balance","payable_settlement","receivable_settlement"]).notNull(),amountCents:bigint("amount_cents",{mode:"number"}).notNull(),previousBalanceCents:bigint("previous_balance_cents",{mode:"number"}).notNull(),resultingBalanceCents:bigint("resulting_balance_cents",{mode:"number"}).notNull(),occurredAt:timestamp("occurred_at",{mode:"string"}).defaultNow().notNull(),createdBy:varchar("created_by",{length:80}).notNull(),metadata:text(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().notNull(),
},t=>[uniqueIndex("uq_erp_fin_ledger_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fin_ledger_settlement").on(t.settlementId),index("idx_erp_fin_ledger_tenant_account_date").on(t.clientId,t.financialAccountId,t.occurredAt),foreignKey({name:"fk_erp_fin_ledger_account",columns:[t.financialAccountId],foreignColumns:[erpFinancialAccounts.id]}),foreignKey({name:"fk_erp_fin_ledger_entry",columns:[t.financialEntryId],foreignColumns:[erpFinancialEntries.id]}),foreignKey({name:"fk_erp_fin_ledger_settlement",columns:[t.settlementId],foreignColumns:[erpFinancialSettlements.id]})]);

export const erpFiscalSettings = mysqlTable("erp_fiscal_settings", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),taxRegime:mysqlEnum("tax_regime",["mei","simples_nacional","lucro_presumido","lucro_real","other"]).notNull(),taxpayerIndicator:mysqlEnum("taxpayer_indicator",["taxpayer","exempt","non_taxpayer"]).notNull(),stateRegistration:varchar("state_registration",{length:30}),municipalRegistration:varchar("municipal_registration",{length:30}),mainCnae:varchar("main_cnae",{length:10}),ibgeCityCode:varchar("ibge_city_code",{length:7}),environment:mysqlEnum(["homologation","production"]).default("homologation").notNull(),provider:mysqlEnum(["none"]).default("none").notNull(),status:mysqlEnum(["incomplete","ready_for_integration"]).default("incomplete").notNull(),updatedBy:varchar("updated_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fiscal_settings_tenant").on(t.clientId),uniqueIndex("uq_erp_fiscal_settings_public").on(t.clientId,t.publicId)]);

export const erpFiscalSettingsHistory = mysqlTable("erp_fiscal_settings_history", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),clientId:varchar("client_id",{length:80}).notNull(),settingsId:bigint("settings_id",{mode:"number"}).notNull(),operation:mysqlEnum(["created","updated"]).notNull(),status:mysqlEnum(["incomplete","ready_for_integration"]).notNull(),changedFields:text("changed_fields").notNull(),changedBy:varchar("changed_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),
},t=>[index("idx_erp_fiscal_settings_history_tenant_date").on(t.clientId,t.createdAt),foreignKey({name:"fk_erp_fiscal_settings_history_settings",columns:[t.settingsId],foreignColumns:[erpFiscalSettings.id]})]);

export const erpProductFiscalProfiles = mysqlTable("erp_product_fiscal_profiles", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),productId:bigint("product_id",{mode:"number"}).notNull(),ncm:varchar({length:8}),cest:varchar({length:7}),defaultOutboundCfop:varchar("default_outbound_cfop",{length:4}),defaultInboundCfop:varchar("default_inbound_cfop",{length:4}),goodsOrigin:varchar("goods_origin",{length:2}),fiscalUnit:varchar("fiscal_unit",{length:12}).notNull(),gtin:varchar({length:14}),serviceCode:varchar("service_code",{length:20}),operationNature:varchar("operation_nature",{length:120}),internalNotes:text("internal_notes"),completeness:mysqlEnum(["incomplete","complete"]).default("incomplete").notNull(),updatedBy:varchar("updated_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_product_fiscal_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_product_fiscal_product").on(t.productId),index("idx_erp_product_fiscal_tenant_complete").on(t.clientId,t.completeness),foreignKey({name:"fk_erp_product_fiscal_product",columns:[t.productId],foreignColumns:[erpProducts.id]})]);

export const erpFiscalDocumentSequences = mysqlTable("erp_fiscal_document_sequences", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),clientId:varchar("client_id",{length:80}).notNull(),year:int().notNull(),nextNumber:int("next_number").default(1).notNull(),
},t=>[uniqueIndex("uq_erp_fiscal_sequence_tenant_year").on(t.clientId,t.year)]);

export const erpFiscalDocuments = mysqlTable("erp_fiscal_documents", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),internalNumber:varchar("internal_number",{length:32}).notNull(),type:mysqlEnum(["sale","purchase","manual"]).notNull(),status:mysqlEnum(["draft","ready_for_integration","cancelled"]).default("draft").notNull(),internalIssueDate:date("internal_issue_date",{mode:"string"}).notNull(),sourcePublicId:varchar("source_public_id",{length:36}),partyNameSnapshot:varchar("party_name_snapshot",{length:255}).notNull(),partyDocumentSnapshot:varchar("party_document_snapshot",{length:30}),totalCents:bigint("total_cents",{mode:"number"}).notNull(),internalNotes:text("internal_notes"),cancelledAt:timestamp("cancelled_at",{mode:"string"}),cancelledBy:varchar("cancelled_by",{length:80}),cancellationReason:varchar("cancellation_reason",{length:500}),createdBy:varchar("created_by",{length:80}).notNull(),updatedBy:varchar("updated_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{mode:"string"}).defaultNow().onUpdateNow().notNull(),
},t=>[uniqueIndex("uq_erp_fiscal_documents_tenant_public").on(t.clientId,t.publicId),uniqueIndex("uq_erp_fiscal_documents_tenant_number").on(t.clientId,t.internalNumber),uniqueIndex("uq_erp_fiscal_documents_tenant_source").on(t.clientId,t.type,t.sourcePublicId),index("idx_erp_fiscal_documents_tenant_status_date").on(t.clientId,t.status,t.internalIssueDate)]);

export const erpFiscalDocumentItems = mysqlTable("erp_fiscal_document_items", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),publicId:varchar("public_id",{length:36}).notNull(),clientId:varchar("client_id",{length:80}).notNull(),fiscalDocumentId:bigint("fiscal_document_id",{mode:"number"}).notNull(),productPublicId:varchar("product_public_id",{length:36}),productNameSnapshot:varchar("product_name_snapshot",{length:180}).notNull(),skuSnapshot:varchar("sku_snapshot",{length:80}),quantityMillis:bigint("quantity_millis",{mode:"number"}).notNull(),unitAmountCents:bigint("unit_amount_cents",{mode:"number"}).notNull(),lineTotalCents:bigint("line_total_cents",{mode:"number"}).notNull(),fiscalProfileSnapshot:text("fiscal_profile_snapshot"),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),
},t=>[uniqueIndex("uq_erp_fiscal_items_document_public").on(t.fiscalDocumentId,t.publicId),index("idx_erp_fiscal_items_tenant_document").on(t.clientId,t.fiscalDocumentId),foreignKey({name:"fk_erp_fiscal_items_document",columns:[t.fiscalDocumentId],foreignColumns:[erpFiscalDocuments.id]})]);

export const erpFiscalDocumentHistory = mysqlTable("erp_fiscal_document_history", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),clientId:varchar("client_id",{length:80}).notNull(),fiscalDocumentId:bigint("fiscal_document_id",{mode:"number"}).notNull(),fromStatus:mysqlEnum("from_status",["draft","ready_for_integration","cancelled"]),toStatus:mysqlEnum("to_status",["draft","ready_for_integration","cancelled"]).notNull(),reason:varchar({length:500}),changedBy:varchar("changed_by",{length:80}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),
},t=>[index("idx_erp_fiscal_history_tenant_document_date").on(t.clientId,t.fiscalDocumentId,t.createdAt),foreignKey({name:"fk_erp_fiscal_history_document",columns:[t.fiscalDocumentId],foreignColumns:[erpFiscalDocuments.id]})]);

export const erpFiscalOperations = mysqlTable("erp_fiscal_operations", {
  id:bigint({mode:"number"}).autoincrement().primaryKey().notNull(),clientId:varchar("client_id",{length:80}).notNull(),idempotencyKey:varchar("idempotency_key",{length:100}).notNull(),operation:mysqlEnum(["create_source","create_manual","ready"]).notNull(),fiscalDocumentId:bigint("fiscal_document_id",{mode:"number"}).notNull(),payloadHash:varchar("payload_hash",{length:64}).notNull(),createdAt:timestamp("created_at",{mode:"string"}).defaultNow().notNull(),
},t=>[uniqueIndex("uq_erp_fiscal_operations_tenant_key").on(t.clientId,t.idempotencyKey),foreignKey({name:"fk_erp_fiscal_operations_document",columns:[t.fiscalDocumentId],foreignColumns:[erpFiscalDocuments.id]})]);
