import { getFailedMessagesPending, incrementRetryCount, markMessageAsCompleted, markMessageAsFailed } from "./baileys-failed-messages";
import { sendBaileysMessage } from "./whatsapp-baileys";

/**
 * Reenviar automaticamente todas as mensagens falhadas quando reconectar
 */
export async function retryFailedMessagesOnReconnect(clientId: string): Promise<void> {
  console.log(`[Baileys] Iniciando reenvio automático de mensagens falhadas para cliente: ${clientId}`);

  try {
    const failedMessages = await getFailedMessagesPending(clientId);

    if (failedMessages.length === 0) {
      console.log(`[Baileys] Nenhuma mensagem falhada pendente para reenvio`);
      return;
    }

    console.log(`[Baileys] Encontradas ${failedMessages.length} mensagens para reenvio automático`);

    for (const msg of failedMessages) {
      try {
        // Verificar se ainda não atingiu o máximo de retries
        if (msg.retry_count >= msg.max_retries) {
          console.log(`[Baileys] Mensagem ${msg.id} atingiu máximo de retries (${msg.retry_count}/${msg.max_retries})`);
          await markMessageAsFailed(msg.id, "Máximo de tentativas atingido");
          continue;
        }

        console.log(`[Baileys] Reenviando mensagem falhada: ${msg.id} para ${msg.phone} (tentativa ${msg.retry_count + 1}/${msg.max_retries})`);

        // Tentar reenviar a mensagem
        await incrementRetryCount(msg.id);

        try {
          // Reenviar usando a função existente
          const result = await sendBaileysMessage(clientId, msg.conversation_id, msg.phone, msg.message_text, 'Sistema');

          // Se bem-sucedido, marcar como completa
          if (result.ok) {
            await markMessageAsCompleted(msg.id);
            console.log(`[Baileys] Mensagem reenviada com sucesso: ${msg.id}`);
          }
        } catch (sendErr: any) {
          console.error(`[Baileys] Erro ao reenviar mensagem ${msg.id}:`, sendErr.message);
          // Deixar como pending/retrying para próxima tentativa
        }
      } catch (err: any) {
        console.error(`[Baileys] Erro ao processar mensagem falhada ${msg.id}:`, err);
      }

      // Pequeno delay entre reenvios para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[Baileys] Reenvio automático concluído`);
  } catch (err: any) {
    console.error(`[Baileys] Erro durante reenvio automático:`, err);
  }
}

/**
 * Verificar periodicamente mensagens falhadas e tentar reenviar
 * (executar a cada 5 minutos)
 */
export async function periodicRetryCheck(clientId: string): Promise<void> {
  setInterval(async () => {
    try {
      const failedMessages = await getFailedMessagesPending(clientId, 10);

      if (failedMessages.length === 0) return;

      console.log(`[Baileys] Verificação periódica: ${failedMessages.length} mensagens pendentes`);

      for (const msg of failedMessages) {
        if (msg.retry_count >= msg.max_retries) {
          await markMessageAsFailed(msg.id, "Máximo de tentativas atingido");
          continue;
        }

        try {
          await incrementRetryCount(msg.id);
          const result = await sendBaileysMessage(clientId, msg.conversation_id, msg.phone, msg.message_text, 'Sistema');
          if (result.ok) {
            await markMessageAsCompleted(msg.id);
            console.log(`[Baileys] Mensagem reenviada (verificação periódica): ${msg.id}`);
          }
        } catch (err: any) {
          console.error(`[Baileys] Erro na verificação periódica para ${msg.id}:`, err.message);
        }

        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (err: any) {
      console.error(`[Baileys] Erro na verificação periódica:`, err);
    }
  }, 5 * 60 * 1000); // 5 minutos
}
