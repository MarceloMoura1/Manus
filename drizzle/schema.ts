import { uniqueIndex, boolean, index, int, mysqlEnum, mysqlTable, serial, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull().default("Usuário MegaDesk"),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  lastSignedIn: timestamp("last_signed_in"),
});

export const tenants = mysqlTable("megadesk_tenants", {
  id: serial("id").primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull().unique(),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  apiTokenHint: varchar("api_token_hint", { length: 40 }).notNull(),
  status: mysqlEnum("status", ["active", "pending", "paused"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = mysqlTable("megadesk_conversations", {
  id: serial("id").primaryKey(),
  tenantId: int("tenant_id").notNull(),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  status: mysqlEnum("status", ["open", "waiting", "resolved"]).notNull().default("open"),
  channel: varchar("channel", { length: 40 }).notNull().default("whatsapp"),
  lastMessage: text("last_message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tickets = mysqlTable("megadesk_tickets", {
  id: serial("id").primaryKey(),
  tenantId: int("tenant_id").notNull(),
  ticketCode: varchar("ticket_code", { length: 40 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  category: mysqlEnum("category", ["venda", "suporte", "financeiro", "reclamacao", "duvida", "agendamento", "pos_venda"]).notNull(),
  status: mysqlEnum("status", ["aberto", "em_progresso", "aguardando_cliente", "resolvido"]).notNull().default("aberto"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const megadeskDomainClients = mysqlTable("megadesk_domain_clients", {
  clientId: varchar("client_id", { length: 80 }).primaryKey(),
  internalId: varchar("internal_id", { length: 80 }).notNull(),
  tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull().unique(),
  company: varchar("company", { length: 255 }).notNull(),
  contact: varchar("contact", { length: 180 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().default(""),
  phone: varchar("phone", { length: 40 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }).notNull().default(""),
  plan: varchar("plan", { length: 120 }).notNull(),
  maxUsers: int("max_users").notNull().default(5),
  statusType: mysqlEnum("status_type", ["active", "test"]).notNull().default("test"),
  status: mysqlEnum("status", ["active", "setup", "paused"]).notNull().default("setup"),
  accessReleased: boolean("access_released").notNull().default(false),
  apiToken: varchar("api_token", { length: 255 }).notNull(),
  modulesJson: text("modules_json").notNull(),
  integrationsJson: text("integrations_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const megadeskDomainClientUsers = mysqlTable("megadesk_domain_client_users", {
  userId: varchar("user_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager", "agent", "viewer"]).notNull().default("viewer"),
  status: mysqlEnum("status", ["active", "blocked"]).notNull().default("blocked"),
  permissionsJson: text("permissions_json").notNull(),
  passwordHash: varchar("password_hash", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const megadeskDomainCustomers = mysqlTable("megadesk_domain_customers", {
  customerId: varchar("customer_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull().unique(),
  company: varchar("company", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  status: mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdc_client").on(table.clientId),
  phoneIdx: index("idx_mdc_phone").on(table.phone),
}));

export const megadeskDomainConversations = mysqlTable("megadesk_domain_conversations", {
  conversationId: varchar("conversation_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  crmClientId: varchar("crm_client_id", { length: 36 }),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["open", "bot", "closed"]).notNull().default("open"),
  lastMessage: text("last_message").notNull(),
  timeLabel: varchar("time_label", { length: 80 }).notNull(),
  messagesJson: text("messages_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const megadeskDomainTickets = mysqlTable("megadesk_domain_tickets", {
  ticketId: varchar("ticket_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  customer: varchar("customer", { length: 180 }).notNull(),
  problem: varchar("problem", { length: 255 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "waiting", "closed"]).notNull().default("open"),
  createdLabel: varchar("created_label", { length: 80 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const megadeskDomainChamados = mysqlTable("megadesk_domain_chamados", {
  chamadoId: varchar("chamado_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  chamadoNumber: int("chamado_number").notNull(),
  customerId: varchar("customer_id", { length: 80 }).notNull(),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 40 }),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerCNPJ: varchar("customer_cnpj", { length: 20 }),
  company: varchar("company", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  observations: text("observations").notNull().default(""),
  status: mysqlEnum("status", ["open", "in_progress", "waiting", "closed"]).notNull().default("open"),
  priority: mysqlEnum("priority", ["baixa", "media", "alta", "critica"]).notNull().default("media"),
  assignedTo: varchar("assigned_to", { length: 80 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdc_client").on(table.clientId),
  statusIdx: index("idx_mdc_status").on(table.status),
  chamadoNumberIdx: index("idx_mdc_chamado_number").on(table.chamadoNumber),
  priorityIdx: index("idx_mdc_priority").on(table.priority),
  assignedToIdx: index("idx_mdc_assigned_to").on(table.assignedTo),
  clientChamadoNumberUniqueIdx: uniqueIndex("idx_mdc_client_chamado_number_unique").on(table.clientId, table.chamadoNumber),
}));

export const megadeskDomainChamadoSequence = mysqlTable("megadesk_domain_chamado_sequence", {
  clientId: varchar("client_id", { length: 80 }).primaryKey(),
  nextChamadoNumber: int("next_chamado_number").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdcs_client").on(table.clientId),
}));


export const megadeskDomainChamadoHistory = mysqlTable("megadesk_domain_chamado_history", {
  historyId: varchar("history_id", { length: 80 }).primaryKey(),
  chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  fieldChanged: varchar("field_changed", { length: 120 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: varchar("changed_by", { length: 80 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  chamadoIdx: index("idx_mdch_chamado").on(table.chamadoId),
  clientIdx: index("idx_mdch_client").on(table.clientId),
  createdAtIdx: index("idx_mdch_created_at").on(table.createdAt),
}));

export const megadeskDomainBotScripts = mysqlTable("megadesk_domain_bot_scripts", {
  scriptId: varchar("script_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description").notNull(),
  initialMessage: text("initial_message").notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdbs_client").on(table.clientId),
}));

export const megadeskDomainOperationalRecords = mysqlTable("megadesk_domain_operational_records", {
  recordId: varchar("record_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull(),
  recordType: mysqlEnum("record_type", ["conversation", "ticket", "tracking", "erp"]).notNull(),
  ownerPhone: varchar("owner_phone", { length: 40 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 80 }).notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const megadeskDomainChamadoActivities = mysqlTable("megadesk_domain_chamado_activities", {
  activityId: varchar("activity_id", { length: 80 }).primaryKey(),
  chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  description: text("description").notNull(),
  attendant: varchar("attendant", { length: 180 }).notNull(),
  actionType: mysqlEnum("action_type", ["register", "edit", "close", "forward", "note", "attachment"]).notNull().default("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  chamadoIdx: index("idx_mdca_chamado").on(table.chamadoId),
  clientIdx: index("idx_mdca_client").on(table.clientId),
  createdAtIdx: index("idx_mdca_created_at").on(table.createdAt),
}));

export const megadeskDomainChamadoAttachments = mysqlTable("megadesk_domain_chamado_attachments", {
  attachmentId: varchar("attachment_id", { length: 80 }).primaryKey(),
  chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: int("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedBy: varchar("uploaded_by", { length: 180 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  chamadoIdx: index("idx_mdca_chamado").on(table.chamadoId),
  clientIdx: index("idx_mdca_client").on(table.clientId),
  createdAtIdx: index("idx_mdca_created_at").on(table.createdAt),
}));

export const megadeskDomainChamadoCollaborators = mysqlTable("megadesk_domain_chamado_collaborators", {
  collaboratorId: varchar("collaborator_id", { length: 80 }).primaryKey(),
  chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  userId: varchar("user_id", { length: 80 }).notNull(),
  userName: varchar("user_name", { length: 180 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  chamadoIdx: index("idx_mdcc_chamado").on(table.chamadoId),
  clientIdx: index("idx_mdcc_client").on(table.clientId),
  userIdx: index("idx_mdcc_user").on(table.userId),
  chamadoUserUniqueIdx: uniqueIndex("idx_mdcc_chamado_user_unique").on(table.chamadoId, table.userId),
}));

export const megadeskCrmClients = mysqlTable("megadesk_crm_clients", {
  crmClientId: varchar("crm_client_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(), // tenant isolamento
  // Dados Básicos
  companyName: varchar("company_name", { length: 255 }).notNull(),
  responsibleName: varchar("responsible_name", { length: 180 }).notNull().default(""),
  cpfCnpj: varchar("cpf_cnpj", { length: 20 }).notNull().default(""),
  phone: varchar("phone", { length: 40 }).notNull().default(""),
  whatsapp: varchar("whatsapp", { length: 40 }).notNull().default(""),
  email: varchar("email", { length: 255 }).notNull().default(""),
  contactsJson: text("contacts_json").notNull().default(""), // JSON array de contatos adicionais
  address: varchar("address", { length: 255 }).notNull().default(""),
  city: varchar("city", { length: 120 }).notNull().default(""),
  state: varchar("state", { length: 2 }).notNull().default(""),
  cep: varchar("cep", { length: 10 }).notNull().default(""),
  // Informações Comerciais
  status: mysqlEnum("status", ["lead", "ativo", "inativo", "cancelado", "inadimplente"]).notNull().default("lead"),
  origin: mysqlEnum("origin", ["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"]).notNull().default("outro"),
  internalResponsible: varchar("internal_responsible", { length: 180 }).notNull().default(""),
  tags: text("tags").notNull().default(""), // JSON array de tags
  observations: text("observations").notNull().default(""),
  lastInteractionAt: timestamp("last_interaction_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mcc_client").on(table.clientId),
  statusIdx: index("idx_mcc_status").on(table.status),
  companyIdx: index("idx_mcc_company").on(table.companyName),
  phoneIdx: index("idx_mcc_phone").on(table.phone),
}));

export const megadeskDomainAuditLogs = mysqlTable("megadesk_domain_audit_logs", {
  auditId: varchar("audit_id", { length: 100 }).primaryKey(),
  platform: mysqlEnum("platform", ["MegaAdmin", "MegaDesk"]).notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  clientId: varchar("client_id", { length: 80 }),
  success: boolean("success").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const megadeskDomainMetrics = mysqlTable("megadesk_domain_metrics", {
  metricId: serial("metric_id").primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  metricType: varchar("metric_type", { length: 80 }).notNull(),
  amount: int("amount").notNull().default(1),
  source: varchar("source", { length: 80 }).notNull().default("system"),
  metadataJson: text("metadata_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adminCredentials = mysqlTable("megaadmin_credentials", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull().default("Administrador"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type AdminCredential = typeof adminCredentials.$inferSelect;

// ===== GEMINI IA CONFIGURATION =====

export const megadeskDomainGeminiConfig = mysqlTable("megadesk_domain_gemini_config", {
  configId: varchar("config_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull().unique(),
  geminiTokenEncrypted: text("gemini_token_encrypted").notNull(),
  quotaMode: mysqlEnum("quota_mode", ["free", "limited", "hybrid"]).notNull().default("free"),
  quotaMensal: int("quota_mensal").notNull().default(5000),
  quotaUsadaMes: int("quota_usada_mes").notNull().default(0),
  dataResetQuota: timestamp("data_reset_quota").notNull(),
  permissionsJson: text("permissions_json").notNull().default("[]"),
  ativo: boolean("ativo").notNull().default(false),
  testeConexao: boolean("teste_conexao").notNull().default(false),
  ultimoTesteEm: timestamp("ultimo_teste_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdgc_client").on(table.clientId),
  ativoIdx: index("idx_mdgc_ativo").on(table.ativo),
}));

export const megadeskDomainIAConversations = mysqlTable("megadesk_domain_ia_conversations", {
  conversationId: varchar("conversation_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  userId: varchar("user_id", { length: 80 }).notNull(),
  userMessage: text("user_message").notNull(),
  iaResponse: text("ia_response").notNull(),
  tokensUsed: int("tokens_used").notNull().default(0),
  tipo: mysqlEnum("tipo", ["consulta", "relatorio", "acao", "analise"]).notNull().default("consulta"),
  status: mysqlEnum("status", ["sucesso", "erro", "pendente"]).notNull().default("sucesso"),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  clientIdx: index("idx_mdic_client").on(table.clientId),
  userIdx: index("idx_mdic_user").on(table.userId),
  createdAtIdx: index("idx_mdic_created_at").on(table.createdAt),
  tipoIdx: index("idx_mdic_tipo").on(table.tipo),
}));

export const megadeskDomainIAConversationHistory = mysqlTable("megadesk_domain_ia_conversation_history", {
  historyId: varchar("history_id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  userId: varchar("user_id", { length: 80 }).notNull(),
  messagesJson: text("messages_json").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  clientIdx: index("idx_mdich_client").on(table.clientId),
  userIdx: index("idx_mdich_user").on(table.userId),
  userClientUniqueIdx: uniqueIndex("idx_mdich_user_client_unique").on(table.userId, table.clientId),
}));

export type MegadeskDomainGeminiConfig = typeof megadeskDomainGeminiConfig.$inferSelect;
export type InsertMegadeskDomainGeminiConfig = typeof megadeskDomainGeminiConfig.$inferInsert;
export type MegadeskDomainIAConversation = typeof megadeskDomainIAConversations.$inferSelect;
export type InsertMegadeskDomainIAConversation = typeof megadeskDomainIAConversations.$inferInsert;
export type MegadeskDomainIAConversationHistory = typeof megadeskDomainIAConversationHistory.$inferSelect;
export type InsertMegadeskDomainIAConversationHistory = typeof megadeskDomainIAConversationHistory.$inferInsert;

// ─── WhatsApp Module Tables ────────────────────────────────────────────────────

/**
 * whatsapp_accounts — uma conta WhatsApp Business por número conectado.
 * Cada conta pertence a um clientId (tenant). Múltiplas contas por tenant são suportadas.
 */
export const waAccounts = mysqlTable("wa_accounts", {
  id: varchar("id", { length: 80 }).primaryKey(), // UUID gerado no app
  clientId: varchar("client_id", { length: 80 }).notNull(), // tenant isolamento
  displayName: varchar("display_name", { length: 180 }).notNull().default(""),
  phoneNumberId: varchar("phone_number_id", { length: 80 }).notNull(),
  businessAccountId: varchar("business_account_id", { length: 80 }).notNull(),
  accessToken: text("access_token").notNull(), // token Meta (criptografado)
  webhookVerifyToken: varchar("webhook_verify_token", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["active", "inactive", "error"]).notNull().default("inactive"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
  clientIdx: index("idx_wa_accounts_client").on(t.clientId),
  phoneIdx: index("idx_wa_accounts_phone").on(t.phoneNumberId),
}));

/**
 * wa_conversations — uma conversa por contato externo.
 * Vinculada ao account e ao tenant.
 */
export const waConversations = mysqlTable("wa_conversations", {
  id: varchar("id", { length: 80 }).primaryKey(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  accountId: varchar("account_id", { length: 80 }).notNull(), // FK wa_accounts.id
  customerName: varchar("customer_name", { length: 180 }).notNull().default(""),
  customerPhone: varchar("customer_phone", { length: 40 }).notNull(),
  lastMessage: text("last_message").notNull().default(""),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  unreadCount: int("unread_count").notNull().default(0),
  status: mysqlEnum("status", ["open", "pending", "closed"]).notNull().default("open"),
  assignedUserId: varchar("assigned_user_id", { length: 80 }), // atendente responsável
  crmClientId: varchar("crm_client_id", { length: 80 }), // vínculo CRM
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
  clientIdx: index("idx_wa_conv_client").on(t.clientId),
  accountIdx: index("idx_wa_conv_account").on(t.accountId),
  phoneIdx: index("idx_wa_conv_phone").on(t.customerPhone),
  statusIdx: index("idx_wa_conv_status").on(t.status),
  lastMsgIdx: index("idx_wa_conv_last_msg").on(t.lastMessageAt),
}));

/**
 * wa_messages — cada mensagem de uma conversa.
 */
export const waMessages = mysqlTable("wa_messages", {
  id: varchar("id", { length: 80 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 80 }).notNull(),
  clientId: varchar("client_id", { length: 80 }).notNull(),
  waMessageId: varchar("wa_message_id", { length: 120 }), // ID retornado pela Meta API
  senderType: mysqlEnum("sender_type", ["customer", "agent", "bot"]).notNull(),
  messageType: mysqlEnum("message_type", ["text", "image", "audio", "video", "document", "template", "sticker", "location", "reaction"]).notNull().default("text"),
  content: text("content").notNull().default(""),
  mediaUrl: text("media_url"),
  mediaId: varchar("media_id", { length: 120 }), // ID de mídia na Meta
  caption: text("caption"),
  status: mysqlEnum("status", ["pending", "sent", "delivered", "read", "failed"]).notNull().default("pending"),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  convIdx: index("idx_wa_msg_conv").on(t.conversationId),
  clientIdx: index("idx_wa_msg_client").on(t.clientId),
  waIdIdx: index("idx_wa_msg_wa_id").on(t.waMessageId),
  createdAtIdx: index("idx_wa_msg_created").on(t.createdAt),
}));

// ─── User Settings Tables ────────────────────────────────────────────────────
/**
 * megadesk_user_settings — configurações de notificações e atendimento por usuário
 * Cada usuário tem suas próprias configurações, não compartilhadas com outros
 */
export const megadeskUserSettings = mysqlTable("megadesk_user_settings", {
  id: varchar("id", { length: 80 }).primaryKey(), // UUID
  clientId: varchar("client_id", { length: 80 }).notNull(),
  userId: varchar("user_id", { length: 80 }).notNull(),
  // Notificações
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  soundVolume: int("sound_volume").notNull().default(70), // 0-100
  muteUntil: timestamp("mute_until"), // null = não silenciado
  desktopNotificationsEnabled: boolean("desktop_notifications_enabled").notNull().default(true),
  whatsappNotificationsEnabled: boolean("whatsapp_notifications_enabled").notNull().default(true),
  ticketsNotificationsEnabled: boolean("tickets_notifications_enabled").notNull().default(true),
  iaNotificationsEnabled: boolean("ia_notifications_enabled").notNull().default(true),
  erpNotificationsEnabled: boolean("erp_notifications_enabled").notNull().default(true),
  trackingNotificationsEnabled: boolean("tracking_notifications_enabled").notNull().default(true),
  showMessagePreview: boolean("show_message_preview").notNull().default(true),
  // Atendimento
  autoResponseEnabled: boolean("auto_response_enabled").notNull().default(false),
  autoResponseMessage: text("auto_response_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
  clientIdx: index("idx_mus_client").on(t.clientId),
  userIdx: index("idx_mus_user").on(t.userId),
  clientUserIdx: uniqueIndex("idx_mus_client_user").on(t.clientId, t.userId),
}));

/**
 * megadesk_user_shortcuts — atalhos de mensagens personalizados por usuário
 * Cada usuário pode criar seus próprios atalhos com /comando
 */
export const megadeskUserShortcuts = mysqlTable("megadesk_user_shortcuts", {
  id: varchar("id", { length: 80 }).primaryKey(), // UUID
  clientId: varchar("client_id", { length: 80 }).notNull(),
  userId: varchar("user_id", { length: 80 }).notNull(),
  shortcutKey: varchar("shortcut_key", { length: 50 }).notNull(), // ex: "ola", "obrigado"
  shortcutMessage: text("shortcut_message").notNull(), // mensagem completa
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
  clientIdx: index("idx_mus_client").on(t.clientId),
  userIdx: index("idx_mus_user").on(t.userId),
  clientUserKeyIdx: uniqueIndex("idx_mus_client_user_key").on(t.clientId, t.userId, t.shortcutKey),
}));

// ─── User Settings Types ──────────────────────────────────────────────────────
export type MegadeskUserSettings = typeof megadeskUserSettings.$inferSelect;
export type InsertMegadeskUserSettings = typeof megadeskUserSettings.$inferInsert;
export type MegadeskUserShortcut = typeof megadeskUserShortcuts.$inferSelect;
export type InsertMegadeskUserShortcut = typeof megadeskUserShortcuts.$inferInsert;

// ─── WhatsApp Module Types ─────────────────────────────────────────────────────
export type WaAccount = typeof waAccounts.$inferSelect;
export type InsertWaAccount = typeof waAccounts.$inferInsert;
export type WaConversation = typeof waConversations.$inferSelect;
export type InsertWaConversation = typeof waConversations.$inferInsert;
export type WaMessage = typeof waMessages.$inferSelect;
export type InsertWaMessage = typeof waMessages.$inferInsert;
