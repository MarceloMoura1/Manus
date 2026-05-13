/**
 * Schema para banco de dados de CLIENTE (tenant)
 * Este schema é replicado em cada banco de dados de cliente
 * Cada cliente tem seu próprio banco de dados isolado
 */

import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const tenantConversations = mysqlTable("conversations", {
  id: varchar("id", { length: 80 }).primaryKey(),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  status: mysqlEnum("status", ["open", "bot", "closed"]).notNull().default("open"),
  channel: varchar("channel", { length: 40 }).notNull().default("whatsapp"),
  lastMessage: text("last_message").notNull(),
  messages: text("messages").notNull(), // JSON array de mensagens
  assignedAgent: varchar("assigned_agent", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  statusIdx: index("idx_conversations_status").on(table.status),
  phoneIdx: index("idx_conversations_phone").on(table.phone),
}));

export const tenantTickets = mysqlTable("tickets", {
  id: varchar("id", { length: 80 }).primaryKey(),
  ticketCode: varchar("ticket_code", { length: 40 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 180 }).notNull(),
  category: mysqlEnum("category", ["venda", "suporte", "financeiro", "reclamacao", "duvida", "agendamento", "pos_venda"]).notNull(),
  status: mysqlEnum("status", ["aberto", "em_progresso", "aguardando_cliente", "resolvido"]).notNull().default("aberto"),
  summary: text("summary").notNull(),
  description: text("description").notNull(),
  assignedAgent: varchar("assigned_agent", { length: 255 }),
  priority: mysqlEnum("priority", ["baixa", "media", "alta", "urgente"]).notNull().default("media"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  statusIdx: index("idx_tickets_status").on(table.status),
  categoryIdx: index("idx_tickets_category").on(table.category),
}));

export const tenantBotScripts = mysqlTable("bot_scripts", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description").notNull(),
  initialMessage: text("initial_message").notNull(),
  active: boolean("active").notNull().default(false),
  trainingData: text("training_data"), // JSON com dados de treinamento
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  activeIdx: index("idx_bot_scripts_active").on(table.active),
}));

export const tenantOperationalRecords = mysqlTable("operational_records", {
  id: varchar("id", { length: 80 }).primaryKey(),
  type: mysqlEnum("type", ["conversation", "ticket", "tracking", "erp"]).notNull(),
  ownerPhone: varchar("owner_phone", { length: 40 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 80 }).notNull(),
  payload: text("payload"), // JSON com dados adicionais
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("idx_operational_records_type").on(table.type),
  createdIdx: index("idx_operational_records_created").on(table.createdAt),
}));

export const tenantUsers = mysqlTable("users", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: mysqlEnum("role", ["admin", "manager", "agent", "viewer"]).notNull().default("viewer"),
  status: mysqlEnum("status", ["active", "blocked"]).notNull().default("blocked"),
  permissions: text("permissions"), // JSON array de permissões
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  emailIdx: index("idx_users_email").on(table.email),
  statusIdx: index("idx_users_status").on(table.status),
}));

export const tenantIntegrations = mysqlTable("integrations", {
  id: varchar("id", { length: 80 }).primaryKey(),
  type: varchar("type", { length: 80 }).notNull(), // "whatsapp", "tracking", "erp", etc
  name: varchar("name", { length: 180 }).notNull(),
  credentials: text("credentials"), // JSON criptografado com credenciais
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  typeIdx: index("idx_integrations_type").on(table.type),
}));

export const tenantAuditLogs = mysqlTable("audit_logs", {
  id: varchar("id", { length: 100 }).primaryKey(),
  action: varchar("action", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 80 }),
  userEmail: varchar("user_email", { length: 255 }),
  details: text("details"), // JSON com detalhes da ação
  success: boolean("success").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("idx_audit_logs_user").on(table.userId),
  createdIdx: index("idx_audit_logs_created").on(table.createdAt),
}));

// Types
export type TenantConversation = typeof tenantConversations.$inferSelect;
export type TenantTicket = typeof tenantTickets.$inferSelect;
export type TenantBotScript = typeof tenantBotScripts.$inferSelect;
export type TenantOperationalRecord = typeof tenantOperationalRecords.$inferSelect;
export type TenantUser = typeof tenantUsers.$inferSelect;
export type TenantIntegration = typeof tenantIntegrations.$inferSelect;
export type TenantAuditLog = typeof tenantAuditLogs.$inferSelect;
