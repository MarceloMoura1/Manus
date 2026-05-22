/**
 * Processador de fila de reprocessamento da Evolution API
 * Executa tentativas de reenvio automaticamente com backoff exponencial
 */

import {
  addFailedMessage,
  getPendingFailedMessages,
  updateFailedMessageStatus,
  incrementRetryCount,
  recordRetryAttempt,
  getQueueConfig,
  cleanupOldMessages,
  getQueueStats,
} from "./db-evolution-queue";
import { getEvolutionAdapter } from "./evolution-manager";

interface ProcessorConfig {
  enabled: boolean;
  intervalMs: number; // Intervalo de verificação
  maxConcurrent: number; // Máximo de reprocessamentos simultâneos
}

let processorConfig: ProcessorConfig = {
  enabled: true,
  intervalMs: 10000, // Verificar a cada 10 segundos
  maxConcurrent: 5,
};

let processorInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Inicializar processador de fila
 */
export function initializeQueueProcessor() {
  if (processorInterval) {
    clearInterval(processorInterval);
  }

  if (!processorConfig.enabled) {
    console.log("[Evolution Queue] Processador desabilitado");
    return;
  }

  console.log("[Evolution Queue] Iniciando processador de fila");

  processorInterval = setInterval(async () => {
    if (isProcessing) {
      console.log("[Evolution Queue] Processamento anterior ainda em andamento");
      return;
    }

    try {
      isProcessing = true;
      await processQueue();
    } catch (error) {
      console.error("[Evolution Queue] Erro ao processar fila:", error);
    } finally {
      isProcessing = false;
    }
  }, processorConfig.intervalMs);
}

/**
 * Parar processador de fila
 */
export function stopQueueProcessor() {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log("[Evolution Queue] Processador parado");
  }
}

/**
 * Processar fila de mensagens falhadas
 */
async function processQueue() {
  // Obter todos os clientes com mensagens pendentes
  // Por enquanto, processamos uma amostra
  const sampleClients = ["client-1", "client-2", "client-3"];

  for (const clientId of sampleClients) {
    try {
      const config = await getQueueConfig(clientId);
      if (!config?.autoRetryEnabled) {
        continue;
      }

      await processClientQueue(clientId);
    } catch (error) {
      console.error(
        `[Evolution Queue] Erro ao processar fila do cliente ${clientId}:`,
        error
      );
    }
  }
}

/**
 * Processar fila de um cliente específico
 */
async function processClientQueue(clientId: string) {
  const pendingMessages = await getPendingFailedMessages(clientId);

  if (pendingMessages.length === 0) {
    return;
  }

  console.log(
    `[Evolution Queue] Processando ${pendingMessages.length} mensagens para cliente ${clientId}`
  );

  // Processar até maxConcurrent mensagens simultaneamente
  const chunks = [];
  for (let i = 0; i < pendingMessages.length; i += processorConfig.maxConcurrent) {
    chunks.push(
      pendingMessages.slice(i, i + processorConfig.maxConcurrent)
    );
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map((message) => retryMessage(clientId, message))
    );
  }

  // Limpar mensagens antigas
  await cleanupOldMessages(clientId);

  // Registrar estatísticas
  const stats = await getQueueStats(clientId);
  console.log(
    `[Evolution Queue] Stats para ${clientId}: ${stats.sent} enviadas, ${stats.pending} pendentes, ${stats.permanentFailed} falhadas permanentemente`
  );
}

/**
 * Tentar reenviar uma mensagem
 */
async function retryMessage(
  clientId: string,
  message: any
) {
  const startTime = Date.now();

  try {
    console.log(
      `[Evolution Queue] Reenviando mensagem ${message.failedMessageId} para ${message.phoneNumber}`
    );

    // Atualizar status para "retrying"
    await updateFailedMessageStatus(
      message.failedMessageId,
      "retrying"
    );

    // Tentar enviar mensagem
    const adapter = getEvolutionAdapter();
    const result = await adapter.sendMessage(
      clientId,
      message.conversationId,
      message.phoneNumber,
      message.messageText,
      message.agentName || "System"
    );

    const responseTime = Date.now() - startTime;

    if (result.ok) {
      // Sucesso!
      console.log(
        `[Evolution Queue] ✅ Mensagem ${message.failedMessageId} reenviada com sucesso`
      );

      await updateFailedMessageStatus(
        message.failedMessageId,
        "sent",
        result.messageId
      );

      await recordRetryAttempt(
        message.failedMessageId,
        message.retryCount + 1,
        "success",
        undefined,
        undefined,
        responseTime
      );
    } else {
      // Falha - incrementar retry count
      console.log(
        `[Evolution Queue] ❌ Falha ao reenviar ${message.failedMessageId}: ${result.error}`
      );

      const retryResult = await incrementRetryCount(
        message.failedMessageId,
        result.error,
        result.error
      );

      await recordRetryAttempt(
        message.failedMessageId,
        message.retryCount + 1,
        "failed",
        result.error,
        result.error,
        responseTime
      );

      if (retryResult?.status === "failed_permanent") {
        console.log(
          `[Evolution Queue] ⚠️ Mensagem ${message.failedMessageId} atingiu limite de tentativas`
        );
      }
    }
  } catch (error) {
    console.error(
      `[Evolution Queue] Erro ao reenviar ${message.failedMessageId}:`,
      error
    );

    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await incrementRetryCount(
      message.failedMessageId,
      errorMessage,
      "INTERNAL_ERROR"
    );

    await recordRetryAttempt(
      message.failedMessageId,
      message.retryCount + 1,
      "failed",
      errorMessage,
      "INTERNAL_ERROR",
      responseTime
    );
  }
}

/**
 * Configurar processador
 */
export function configureQueueProcessor(config: Partial<ProcessorConfig>) {
  processorConfig = { ...processorConfig, ...config };

  if (processorConfig.enabled && !processorInterval) {
    initializeQueueProcessor();
  } else if (!processorConfig.enabled && processorInterval) {
    stopQueueProcessor();
  }
}

/**
 * Obter status do processador
 */
export function getProcessorStatus() {
  return {
    enabled: processorConfig.enabled,
    isProcessing,
    intervalMs: processorConfig.intervalMs,
    maxConcurrent: processorConfig.maxConcurrent,
  };
}

/**
 * Processar fila manualmente (para testes ou acionamento manual)
 */
export async function processQueueManually(clientId?: string) {
  if (isProcessing) {
    throw new Error("Processamento já em andamento");
  }

  try {
    isProcessing = true;

    if (clientId) {
      await processClientQueue(clientId);
    } else {
      await processQueue();
    }

    return { success: true, message: "Fila processada com sucesso" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    isProcessing = false;
  }
}

/**
 * Adicionar mensagem falhada e agendar reprocessamento
 */
export async function scheduleFailedMessage(
  clientId: string,
  conversationId: string,
  phoneNumber: string,
  messageText: string,
  agentName?: string,
  messageId?: string,
  error?: string,
  errorCode?: string
) {
  const failedMessageId = await addFailedMessage(
    clientId,
    conversationId,
    phoneNumber,
    messageText,
    agentName,
    messageId,
    error,
    errorCode
  );

  console.log(
    `[Evolution Queue] Mensagem agendada para reprocessamento: ${failedMessageId}`
  );

  return failedMessageId;
}
