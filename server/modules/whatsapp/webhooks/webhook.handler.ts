/**
 * WhatsApp Module — Webhook Handler
 * Handler Express para o endpoint /api/webhooks/meta
 * Valida assinatura, processa mensagens e status.
 */
import type { Request, Response } from "express";
import { validateWebhookSignature, validateVerifyToken } from "../meta/webhook-validator";
import { getWaAccountByPhoneNumberId } from "../repositories/whatsapp.repo";
import { processIncomingMessage, processMessageStatus } from "./message.processor";
import type { MetaWebhookPayload } from "../types";

// App Secret da Meta — deve ser configurado via variável de ambiente
const META_APP_SECRET = process.env.META_APP_SECRET ?? "";

/**
 * GET /api/webhooks/meta
 * Verificação do webhook pela Meta (challenge).
 */
export async function handleWebhookVerify(req: Request, res: Response): Promise<void> {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  if (mode !== "subscribe") {
    res.status(403).json({ error: "Invalid mode" });
    return;
  }

  // Buscar a conta pelo verify_token (cada conta tem seu próprio token)
  // Isso permite múltiplos números no mesmo webhook endpoint
  const account = await findAccountByVerifyToken(token);

  if (!account) {
    console.warn(`[WA Webhook] Verify token não encontrado: ${token}`);
    res.status(403).json({ error: "Invalid verify token" });
    return;
  }

  console.log(`[WA Webhook] Verificação bem-sucedida para conta: ${account.id}`);
  res.status(200).send(challenge);
}

/**
 * POST /api/webhooks/meta
 * Recebe eventos de mensagem e status da Meta.
 */
export async function handleWebhookEvent(req: Request, res: Response): Promise<void> {
  // Validar assinatura HMAC (segurança)
  if (META_APP_SECRET) {
    const signature = req.headers["x-hub-signature-256"] as string ?? "";
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));

    if (!validateWebhookSignature(rawBody, signature, META_APP_SECRET)) {
      console.warn("[WA Webhook] Assinatura inválida — requisição rejeitada");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // Responder 200 imediatamente para a Meta (evitar timeout/retry)
  res.status(200).json({ status: "ok" });

  // Processar de forma assíncrona
  const payload = req.body as MetaWebhookPayload;

  if (payload.object !== "whatsapp_business_account") {
    return;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      if (!phoneNumberId) continue;

      // Processar mensagens recebidas
      for (const message of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === message.from);
        processIncomingMessage(phoneNumberId, message, contact).catch((err) => {
          console.error("[WA Webhook] Erro ao processar mensagem:", err);
        });
      }

      // Processar atualizações de status
      for (const status of value.statuses ?? []) {
        processMessageStatus(status).catch((err) => {
          console.error("[WA Webhook] Erro ao processar status:", err);
        });
      }
    }
  }
}

// ─── Helper interno ────────────────────────────────────────────────────────────

async function findAccountByVerifyToken(token: string) {
  // Importação dinâmica para evitar circular dependency
  const { getDb } = await import("../../../db");
  const db = getDb();
  const { waAccounts } = await import("../../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [row] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.webhookVerifyToken, token));

  return row ?? null;
}
