import { getPool } from "./db";
import { v4 as uuidv4 } from "uuid";

/**
 * Salvar mensagem falhada na tabela baileys_failed_messages
 */
export async function saveFailedMessage(
  clientId: string,
  conversationId: string,
  phone: string,
  messageText: string,
  errorType?: string,
  errorMessage?: string
): Promise<string> {
  const id = uuidv4();
  const now = new Date();

  try {
    await getPool().execute(
      `INSERT INTO baileys_failed_messages 
       (id, client_id, conversation_id, phone, message_text, error_type, error_message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, clientId, conversationId, phone, messageText, errorType || null, errorMessage || null, now]
    );

    console.log(`[Baileys] Mensagem falhada salva: ${id} para ${phone}`);
    return id;
  } catch (err: any) {
    console.error(`[Baileys] Erro ao salvar mensagem falhada:`, err);
    throw err;
  }
}

/**
 * Obter mensagens falhadas pendentes de reenvio
 */
export async function getFailedMessagesPending(
  clientId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const limitNum = parseInt(String(limit), 10);
    const [rows]: any = await getPool().execute(
      `SELECT * FROM baileys_failed_messages 
       WHERE client_id = ? AND status IN ('pending', 'retrying') 
       ORDER BY created_at ASC 
       LIMIT ${limitNum}`,
      [clientId]
    );

    return rows || [];
  } catch (err: any) {
    console.error(`[Baileys] Erro ao obter mensagens falhadas:`, err);
    return [];
  }
}

/**
 * Atualizar status de mensagem falhada após reenvio bem-sucedido
 */
export async function markMessageAsCompleted(messageId: string): Promise<void> {
  try {
    const now = new Date();
    await getPool().execute(
      `UPDATE baileys_failed_messages 
       SET status = 'completed', completed_at = ? 
       WHERE id = ?`,
      [now, messageId]
    );

    console.log(`[Baileys] Mensagem marcada como completa: ${messageId}`);
  } catch (err: any) {
    console.error(`[Baileys] Erro ao marcar mensagem como completa:`, err);
  }
}

/**
 * Incrementar retry_count e atualizar last_retry_at
 */
export async function incrementRetryCount(messageId: string): Promise<void> {
  try {
    const now = new Date();
    await getPool().execute(
      `UPDATE baileys_failed_messages 
       SET retry_count = retry_count + 1, last_retry_at = ? 
       WHERE id = ?`,
      [now, messageId]
    );

    console.log(`[Baileys] Retry count incrementado para: ${messageId}`);
  } catch (err: any) {
    console.error(`[Baileys] Erro ao incrementar retry count:`, err);
  }
}

/**
 * Marcar mensagem como falhada permanentemente (max retries atingido)
 */
export async function markMessageAsFailed(messageId: string, finalError?: string): Promise<void> {
  try {
    const now = new Date();
    await getPool().execute(
      `UPDATE baileys_failed_messages 
       SET status = 'failed', completed_at = ?, error_message = COALESCE(?, error_message) 
       WHERE id = ?`,
      [now, finalError || null, messageId]
    );

    console.log(`[Baileys] Mensagem marcada como falhada permanentemente: ${messageId}`);
  } catch (err: any) {
    console.error(`[Baileys] Erro ao marcar mensagem como falhada:`, err);
  }
}

/**
 * Remover mensagem falhada após reenvio bem-sucedido
 */
export async function removeFailedMessage(messageId: string): Promise<void> {
  try {
    await getPool().execute(
      `DELETE FROM baileys_failed_messages WHERE id = ?`,
      [messageId]
    );

    console.log(`[Baileys] Mensagem falhada removida: ${messageId}`);
  } catch (err: any) {
    console.error(`[Baileys] Erro ao remover mensagem falhada:`, err);
  }
}

/**
 * Obter todas as mensagens falhadas de um cliente (para dashboard)
 */
export async function getAllFailedMessages(clientId: string): Promise<any[]> {
  try {
    const [rows]: any = await getPool().execute(
      `SELECT * FROM baileys_failed_messages 
       WHERE client_id = ? 
       ORDER BY created_at DESC`,
      [clientId]
    );

    return rows || [];
  } catch (err: any) {
    console.error(`[Baileys] Erro ao obter todas as mensagens falhadas:`, err);
    return [];
  }
}

/**
 * Contar mensagens falhadas pendentes por cliente
 */
export async function countPendingFailedMessages(clientId: string): Promise<number> {
  try {
    const [rows]: any = await getPool().execute(
      `SELECT COUNT(*) as count FROM baileys_failed_messages 
       WHERE client_id = ? AND status IN ('pending', 'retrying')`,
      [clientId]
    );

    return rows?.[0]?.count || 0;
  } catch (err: any) {
    console.error(`[Baileys] Erro ao contar mensagens falhadas:`, err);
    return 0;
  }
}

/**
 * Limpar mensagens falhadas antigas (mais de 7 dias)
 */
export async function cleanupOldFailedMessages(daysOld: number = 7): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const [result]: any = await getPool().execute(
      `DELETE FROM baileys_failed_messages 
       WHERE status = 'completed' AND completed_at < ?`,
      [cutoffDate]
    );

    const deletedCount = result?.affectedRows || 0;
    console.log(`[Baileys] Limpeza de mensagens antigas: ${deletedCount} removidas`);
    return deletedCount;
  } catch (err: any) {
    console.error(`[Baileys] Erro ao limpar mensagens antigas:`, err);
    return 0;
  }
}
