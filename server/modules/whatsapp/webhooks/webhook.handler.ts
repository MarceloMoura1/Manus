/**
 * WhatsApp Module — Webhook Handler
 * Handler Express para o endpoint /api/webhooks/meta
 * Valida assinatura, processa mensagens e status.
 */
import type { Request, Response } from "express";
import { validateWebhookSignature, validateVerifyToken } from "../meta/webhook-validator";
import { getWaAccountByPhoneNumberId } from "../repositories/whatsapp.repo";
import { processIncomingMessage, processMessageStatus } from "./message.processor";
import { metaWebhookEnvelopeSchema, metaWebhookPayloadSchema, webhookVerifySchema } from "../validators";

// App Secret da Meta — deve ser configurado via variável de ambiente
export interface WebhookRequest extends Request { rawBody?: Buffer }

/**
 * GET /api/webhooks/meta
 * Verificação do webhook pela Meta (challenge).
 */
export async function handleWebhookVerify(req: Request, res: Response): Promise<void> {
  const verification = webhookVerifySchema.safeParse(req.query);
  if (!verification.success) {
    res.status(403).json({ error: "Invalid mode" });
    return;
  }
  const token = verification.data["hub.verify_token"];
  const challenge = verification.data["hub.challenge"];

  // Buscar a conta pelo verify_token (cada conta tem seu próprio token)
  // Isso permite múltiplos números no mesmo webhook endpoint
  const account = await findAccountByVerifyToken(token);

  if (!account) {
    console.warn("[WA Webhook] Verify token não encontrado.");
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
export async function handleWebhookEvent(req: WebhookRequest, res: Response): Promise<void> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    res.status(503).json({ error: "Webhook unavailable" });
    return;
  }
  // Validar assinatura HMAC (segurança)
  {
    const signatureHeader = req.headers["x-hub-signature-256"];
    const signature = typeof signatureHeader === "string" ? signatureHeader : "";
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));

    if (!validateWebhookSignature(rawBody, signature, appSecret)) {
      console.warn("[WA Webhook] Assinatura inválida — requisição rejeitada");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  const envelope = metaWebhookEnvelopeSchema.safeParse(req.body);
  if (!envelope.success) {
    res.status(400).json({ error: "Invalid webhook envelope" });
    return;
  }
  if (envelope.data.object !== "whatsapp_business_account") {
    res.status(200).json({ status: "ignored" });
    return;
  }
  const parsedPayload = metaWebhookPayloadSchema.safeParse(req.body);
  if (!parsedPayload.success) {
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }
  const payload = parsedPayload.data;
  res.status(200).json({ status: "accepted" });

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      if (!phoneNumberId) continue;
      let account;
      try {
        account = await getWaAccountByPhoneNumberId(phoneNumberId);
      } catch {
        console.warn("[WA Webhook] Conta não pôde ser resolvida com segurança.");
        continue;
      }
      if (!account) {
        console.warn("[WA Webhook] Conta não pôde ser resolvida com segurança.");
        continue;
      }

      // Processar mensagens recebidas
      for (const message of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === message.from);
        processIncomingMessage(account, message, contact).catch(() => {
          console.error("[WA Webhook] Erro ao processar mensagem.");
        });
      }

      // Processar atualizações de status
      for (const status of value.statuses ?? []) {
        processMessageStatus(account.clientId, status).catch(() => {
          console.error("[WA Webhook] Erro ao processar status.");
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
