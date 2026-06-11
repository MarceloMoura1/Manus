/**
 * Schema para fila de reprocessamento de Evolution API
 * Armazena mensagens que falharam e precisam ser reenviadas
 */

import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  int,
  mysqlEnum,
  index,
  primaryKey,
} from "drizzle-orm/mysql-core";

/**
 * Tabela de mensagens falhadas
 * Armazena mensagens que falharam durante envio
 * Será reenviada automaticamente ao reconectar
 */
export const evolutionFailedMessages = mysqlTable(
  "evolution_failed_messages",
  {
    // Identificadores
    failedMessageId: varchar("failed_message_id", { length: 255 })
      .notNull()
      .primaryKey(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    conversationId: varchar("conversation_id", { length: 255 }).notNull(),
    messageId: varchar("message_id", { length: 255 }),

    // Dados da mensagem
    phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
    messageText: text("message_text").notNull(),
    agentName: varchar("agent_name", { length: 255 }),

    // Status de reprocessamento
    status: mysqlEnum("status", [
      "pending",
      "retrying",
      "sent",
      "failed_permanent",
    ])
      .notNull()
      .default("pending"),
    retryCount: int("retry_count").notNull().default(0),
    maxRetries: int("max_retries").notNull().default(3),

    // Erro
    lastError: text("last_error"),
    errorCode: varchar("error_code", { length: 50 }),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    nextRetryAt: timestamp("next_retry_at"),
    sentAt: timestamp("sent_at"),
  },
  (table) => ({
    clientIdIdx: index("evolution_failed_messages_client_id_idx").on(
      table.clientId
    ),
    statusIdx: index("evolution_failed_messages_status_idx").on(table.status),
    nextRetryIdx: index("evolution_failed_messages_next_retry_idx").on(
      table.nextRetryAt
    ),
    clientStatusIdx: index("evolution_failed_messages_client_status_idx").on(
      table.clientId,
      table.status
    ),
  })
);

/**
 * Tabela de histórico de reprocessamento
 * Rastreia todas as tentativas de reenvio
 */
export const evolutionRetryHistory = mysqlTable(
  "evolution_retry_history",
  {
    // Identificadores
    retryHistoryId: varchar("retry_history_id", { length: 255 })
      .notNull()
      .primaryKey(),
    failedMessageId: varchar("failed_message_id", { length: 255 }).notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),

    // Informações da tentativa
    retryNumber: int("retry_number").notNull(),
    status: mysqlEnum("status", ["success", "failed"])
      .notNull()
      .default("failed"),
    error: text("error"),
    errorCode: varchar("error_code", { length: 50 }),

    // Timestamps
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
    responseTime: int("response_time"), // em ms
  },
  (table) => ({
    failedMessageIdIdx: index("evolution_retry_history_failed_message_id_idx")
      .on(table.failedMessageId),
    clientIdIdx: index("evolution_retry_history_client_id_idx").on(
      table.clientId
    ),
    statusIdx: index("evolution_retry_history_status_idx").on(table.status),
  })
);

/**
 * Tabela de configuração de reprocessamento
 * Armazena configurações por cliente
 */
export const evolutionQueueConfig = mysqlTable(
  "evolution_queue_config",
  {
    // Identificadores
    configId: varchar("config_id", { length: 255 })
      .notNull()
      .primaryKey(),
    clientId: varchar("client_id", { length: 255 }).notNull().unique(),

    // Configurações
    maxRetries: int("max_retries").notNull().default(3),
    retryDelayMs: int("retry_delay_ms").notNull().default(1000), // 1 segundo
    backoffMultiplier: int("backoff_multiplier").notNull().default(2), // exponencial
    maxBackoffMs: int("max_backoff_ms").notNull().default(60000), // 1 minuto
    autoRetryEnabled: int("auto_retry_enabled").notNull().default(1), // boolean como int
    cleanupAfterDaysSuccess: int("cleanup_after_days_success").notNull().default(7),
    cleanupAfterDaysFailed: int("cleanup_after_days_failed").notNull().default(30),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    clientIdIdx: index("evolution_queue_config_client_id_idx").on(
      table.clientId
    ),
  })
);

/**
 * Tabela de métricas de fila
 * Rastreia performance da fila de reprocessamento
 */
export const evolutionQueueMetrics = mysqlTable(
  "evolution_queue_metrics",
  {
    // Identificadores
    metricsId: varchar("metrics_id", { length: 255 })
      .notNull()
      .primaryKey(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    date: timestamp("date").notNull(), // Agregado por dia

    // Métricas
    totalFailed: int("total_failed").notNull().default(0),
    totalRetried: int("total_retried").notNull().default(0),
    totalSucceeded: int("total_succeeded").notNull().default(0),
    totalPermanentFailed: int("total_permanent_failed").notNull().default(0),

    // Performance
    avgRetryCount: int("avg_retry_count").notNull().default(0),
    avgResponseTimeMs: int("avg_response_time_ms").notNull().default(0),
    successRate: int("success_rate").notNull().default(0), // percentual 0-100

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    clientIdIdx: index("evolution_queue_metrics_client_id_idx").on(
      table.clientId
    ),
    dateIdx: index("evolution_queue_metrics_date_idx").on(table.date),
    clientDateIdx: index("evolution_queue_metrics_client_date_idx").on(
      table.clientId,
      table.date
    ),
  })
);
