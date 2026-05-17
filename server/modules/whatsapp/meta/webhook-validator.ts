/**
 * WhatsApp Module — Webhook Validator
 * Valida assinatura HMAC-SHA256 dos webhooks da Meta.
 * Documentação: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifica a assinatura do webhook Meta.
 * O header X-Hub-Signature-256 contém sha256=<hash>
 */
export function validateWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const receivedHash = signature.slice("sha256=".length);
  const expectedHash = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(receivedHash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Verifica o token de verificação do webhook (GET request da Meta).
 */
export function validateVerifyToken(
  receivedToken: string,
  expectedToken: string
): boolean {
  return receivedToken === expectedToken;
}
