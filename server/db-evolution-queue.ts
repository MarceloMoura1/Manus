/**
 * Helpers de banco de dados para fila de reprocessamento da Evolution API
 * Gerencia mensagens falhadas, retry history e métricas
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";
import {
  evolutionFailedMessages,
  evolutionRetryHistory,
  evolutionQueueConfig,
  evolutionQueueMetrics,
} from "../drizzle/schema-evolution-queue";
import { eq, and, lt, gte, lte, sql } from "drizzle-orm";

/**
 * Adicionar mensagem falhada à fila
 */
export async function addFailedMessage(
  clientId: string,
  conversationId: string,
  phoneNumber: string,
  messageText: string,
  agentName?: string,
  messageId?: string,
  error?: string,
  errorCode?: string
) {
  const failedMessageId = `failed-${uuidv4()}`;
  const db = getDb();

  await db.insert(evolutionFailedMessages).values({
    failedMessageId,
    clientId,
    conversationId,
    phoneNumber,
    messageText,
    agentName,
    messageId,
    status: "pending",
    retryCount: 0,
    maxRetries: 3,
    lastError: error,
    errorCode,
    createdAt: new Date(),
    updatedAt: new Date(),
    nextRetryAt: new Date(Date.now() + 1000), // Próxima tentativa em 1s
  });

  return failedMessageId;
}

/**
 * Obter mensagens pendentes para reprocessamento
 */
export async function getPendingFailedMessages(clientId: string) {
  const now = new Date();
  const db = getDb();

  const messages = await db
    .select()
    .from(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "pending"),
        lte(evolutionFailedMessages.nextRetryAt, now)
      )
    )
    .limit(10); // Processar no máximo 10 por vez

  return messages;
}

/**
 * Atualizar status de mensagem falhada
 */
export async function updateFailedMessageStatus(
  failedMessageId: string,
  status: "pending" | "retrying" | "sent" | "failed_permanent",
  messageId?: string,
  error?: string,
  errorCode?: string
) {
  const db = getDb();
  const updateData: any = {
    status,
    updatedAt: new Date(),
  };

  if (messageId) updateData.messageId = messageId;
  if (error) updateData.lastError = error;
  if (errorCode) updateData.errorCode = errorCode;

  if (status === "sent") {
    updateData.sentAt = new Date();
  }

  await db
    .update(evolutionFailedMessages)
    .set(updateData)
    .where(eq(evolutionFailedMessages.failedMessageId, failedMessageId));
}

/**
 * Incrementar retry count e calcular próxima tentativa
 */
export async function incrementRetryCount(
  failedMessageId: string,
  error?: string,
  errorCode?: string
) {
  const db = getDb();
  const message = await db
    .select()
    .from(evolutionFailedMessages)
    .where(eq(evolutionFailedMessages.failedMessageId, failedMessageId))
    .then((rows) => rows[0]);

  if (!message) return;

  const newRetryCount = message.retryCount + 1;
  const config = await getQueueConfig(message.clientId);

  // Calcular próxima tentativa com backoff exponencial
  const baseDelay = config?.retryDelayMs || 1000;
  const multiplier = config?.backoffMultiplier || 2;
  const maxBackoff = config?.maxBackoffMs || 60000;

  const delay = Math.min(
    baseDelay * Math.pow(multiplier, newRetryCount - 1),
    maxBackoff
  );

  const nextRetryAt = new Date(Date.now() + delay);

  // Determinar se deve continuar tentando
  const maxRetries = config?.maxRetries || 3;
  const status =
    newRetryCount >= maxRetries ? "failed_permanent" : "retrying";

  await db
    .update(evolutionFailedMessages)
    .set({
      retryCount: newRetryCount,
      status,
      lastError: error,
      errorCode,
      nextRetryAt: status === "failed_permanent" ? null : nextRetryAt,
      updatedAt: new Date(),
    })
    .where(eq(evolutionFailedMessages.failedMessageId, failedMessageId));

  return { newRetryCount, nextRetryAt, status };
}

/**
 * Registrar tentativa de reenvio
 */
export async function recordRetryAttempt(
  failedMessageId: string,
  retryNumber: number,
  status: "success" | "failed",
  error?: string,
  errorCode?: string,
  responseTime?: number
) {
  const db = getDb();
  const retryHistoryId = `retry-${uuidv4()}`;

  const failedMessage = await db
    .select()
    .from(evolutionFailedMessages)
    .where(eq(evolutionFailedMessages.failedMessageId, failedMessageId))
    .then((rows) => rows[0]);

  if (!failedMessage) return;

  await db.insert(evolutionRetryHistory).values({
    retryHistoryId,
    failedMessageId,
    clientId: failedMessage.clientId,
    retryNumber,
    status,
    error,
    errorCode,
    responseTime,
    attemptedAt: new Date(),
  });

  return retryHistoryId;
}

/**
 * Obter histórico de tentativas
 */
export async function getRetryHistory(failedMessageId: string) {
  const db = getDb();
  return await db
    .select()
    .from(evolutionRetryHistory)
    .where(eq(evolutionRetryHistory.failedMessageId, failedMessageId))
    .orderBy(evolutionRetryHistory.attemptedAt);
}

/**
 * Obter ou criar configuração de fila para cliente
 */
export async function getQueueConfig(clientId: string) {
  const db = getDb();
  let config = await db
    .select()
    .from(evolutionQueueConfig)
    .where(eq(evolutionQueueConfig.clientId, clientId))
    .then((rows) => rows[0]);

  if (!config) {
    const configId = `config-${uuidv4()}`;
    await db.insert(evolutionQueueConfig).values({
      configId,
      clientId,
      maxRetries: 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 60000,
      autoRetryEnabled: 1,
      cleanupAfterDaysSuccess: 7,
      cleanupAfterDaysFailed: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    config = await db
      .select()
      .from(evolutionQueueConfig)
      .where(eq(evolutionQueueConfig.clientId, clientId))
      .then((rows) => rows[0]);
  }

  return config;
}

/**
 * Atualizar configuração de fila
 */
export async function updateQueueConfig(
  clientId: string,
  updates: {
    maxRetries?: number;
    retryDelayMs?: number;
    backoffMultiplier?: number;
    maxBackoffMs?: number;
    autoRetryEnabled?: boolean;
  }
) {
  const db = getDb();
  const config = await getQueueConfig(clientId);

  const updateData: any = {
    updatedAt: new Date(),
  };

  if (updates.maxRetries !== undefined)
    updateData.maxRetries = updates.maxRetries;
  if (updates.retryDelayMs !== undefined)
    updateData.retryDelayMs = updates.retryDelayMs;
  if (updates.backoffMultiplier !== undefined)
    updateData.backoffMultiplier = updates.backoffMultiplier;
  if (updates.maxBackoffMs !== undefined)
    updateData.maxBackoffMs = updates.maxBackoffMs;
  if (updates.autoRetryEnabled !== undefined)
    updateData.autoRetryEnabled = updates.autoRetryEnabled ? 1 : 0;

  await db
    .update(evolutionQueueConfig)
    .set(updateData)
    .where(eq(evolutionQueueConfig.clientId, clientId));
}

/**
 * Registrar métricas de fila
 */
export async function recordQueueMetrics(
  clientId: string,
  date: Date,
  metrics: {
    totalFailed: number;
    totalRetried: number;
    totalSucceeded: number;
    totalPermanentFailed: number;
    avgRetryCount: number;
    avgResponseTimeMs: number;
    successRate: number;
  }
) {
  const db = getDb();
  const metricsId = `metrics-${uuidv4()}`;

  await db.insert(evolutionQueueMetrics).values({
    metricsId,
    clientId,
    date,
    ...metrics,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return metricsId;
}

/**
 * Obter métricas de fila
 */
export async function getQueueMetrics(
  clientId: string,
  startDate: Date,
  endDate: Date
) {
  const db = getDb();
  return await db
    .select()
    .from(evolutionQueueMetrics)
    .where(
      and(
        eq(evolutionQueueMetrics.clientId, clientId),
        gte(evolutionQueueMetrics.date, startDate),
        lte(evolutionQueueMetrics.date, endDate)
      )
    )
    .orderBy(evolutionQueueMetrics.date);
}

/**
 * Limpar mensagens antigas
 */
export async function cleanupOldMessages(clientId: string) {
  const db = getDb();
  const config = await getQueueConfig(clientId);

  const successCutoff = new Date(
    Date.now() - config!.cleanupAfterDaysSuccess * 24 * 60 * 60 * 1000
  );
  const failedCutoff = new Date(
    Date.now() - config!.cleanupAfterDaysFailed * 24 * 60 * 60 * 1000
  );

  // Deletar mensagens enviadas com sucesso
  await db
    .delete(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "sent"),
        lt(evolutionFailedMessages.sentAt, successCutoff)
      )
    );

  // Deletar mensagens que falharam permanentemente
  await db
    .delete(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "failed_permanent"),
        lt(evolutionFailedMessages.updatedAt, failedCutoff)
      )
    );
}

/**
 * Obter estatísticas da fila
 */
export async function getQueueStats(clientId: string) {
  const db = getDb();

  const pending = await db
    .select({ count: sql`COUNT(*)` })
    .from(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "pending")
      )
    )
    .then((rows) => Number(rows[0]?.count || 0));

  const retrying = await db
    .select({ count: sql`COUNT(*)` })
    .from(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "retrying")
      )
    )
    .then((rows) => Number(rows[0]?.count || 0));

  const sent = await db
    .select({ count: sql`COUNT(*)` })
    .from(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "sent")
      )
    )
    .then((rows) => Number(rows[0]?.count || 0));

  const permanentFailed = await db
    .select({ count: sql`COUNT(*)` })
    .from(evolutionFailedMessages)
    .where(
      and(
        eq(evolutionFailedMessages.clientId, clientId),
        eq(evolutionFailedMessages.status, "failed_permanent")
      )
    )
    .then((rows) => Number(rows[0]?.count || 0));

  const total = pending + retrying + sent + permanentFailed;
  const successRate = total > 0 ? ((sent / total) * 100).toFixed(1) : "0";

  return {
    pending,
    retrying,
    sent,
    permanentFailed,
    total,
    successRate: parseFloat(successRate as string),
  };
}
