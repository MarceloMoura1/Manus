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
  actionType: mysqlEnum("action_type", ["register", "edit", "close", "forward", "note"]).notNull().default("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
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
