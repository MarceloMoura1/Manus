/**
 * Helpers para gerenciar configurações de WhatsApp por cliente
 * Isolamento de tenant garantido em todas as operações
 */
import { getDb } from "./db";
import { megadeskWhatsappConfig } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/**
 * Buscar configuração WhatsApp de um cliente
 */
export async function getWhatsappConfig(clientId: string) {
  const db = getDb();
  const config = await db
    .select()
    .from(megadeskWhatsappConfig)
    .where(eq(megadeskWhatsappConfig.clientId, clientId))
    .limit(1);

  return config[0] || null;
}

/**
 * Salvar ou atualizar configuração WhatsApp
 */
export async function saveWhatsappConfig(clientId: string, data: {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
  phoneNumber: string;
  webhookUrl?: string;
}) {
  const db = getDb();

  // Verificar se já existe
  const existing = await getWhatsappConfig(clientId);

  if (existing) {
    // Atualizar
    await db
      .update(megadeskWhatsappConfig)
      .set({
        phoneNumberId: data.phoneNumberId,
        businessAccountId: data.businessAccountId,
        accessToken: data.accessToken,
        webhookVerifyToken: data.webhookVerifyToken,
        phoneNumber: data.phoneNumber,
        webhookUrl: data.webhookUrl,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(megadeskWhatsappConfig.clientId, clientId));

    return await getWhatsappConfig(clientId);
  } else {
    // Criar novo
    const id = uuidv4();
    await db.insert(megadeskWhatsappConfig).values({
      configId: id,
      clientId,
      phoneNumberId: data.phoneNumberId,
      businessAccountId: data.businessAccountId,
      accessToken: data.accessToken,
      webhookVerifyToken: data.webhookVerifyToken,
      phoneNumber: data.phoneNumber,
      webhookUrl: data.webhookUrl,
      connectionStatus: 0,
    });

    return await getWhatsappConfig(clientId);
  }
}

/**
 * Atualizar status de conexão
 */
export async function updateConnectionStatus(clientId: string, isConnected: boolean) {
  const db = getDb();
  await db
    .update(megadeskWhatsappConfig)
    .set({
      connectionStatus: isConnected ? 1 : 0,
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(megadeskWhatsappConfig.clientId, clientId));

  return await getWhatsappConfig(clientId);
}

/**
 * Atualizar status do webhook
 */
export async function updateWebhookStatus(
  clientId: string,
  status: "pending" | "verified" | "failed"
) {
  const db = getDb();
  await db
    .update(megadeskWhatsappConfig)
    .set({
      // webhookStatus removido — não existe no schema atual
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(megadeskWhatsappConfig.clientId, clientId));

  return await getWhatsappConfig(clientId);
}

/**
 * Deletar configuração WhatsApp (apenas para admin)
 */
export async function deleteWhatsappConfig(clientId: string) {
  const db = getDb();
  await db
    .delete(megadeskWhatsappConfig)
    .where(eq(megadeskWhatsappConfig.clientId, clientId));
}
