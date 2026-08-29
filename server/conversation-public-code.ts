import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateConversationPublicCode(now = new Date(), random = randomBytes): string {
  const parts = [
    now.getUTCFullYear().toString().slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const bytes = random(4);
  let suffix = "";
  for (let index = 0; index < 4; index += 1) suffix += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  return `CV-${parts}-${suffix}`;
}

export function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062
    || candidate?.cause?.code === "ER_DUP_ENTRY" || candidate?.cause?.errno === 1062;
}

export function duplicateConstraint(error: unknown): string | null {
  if (!isDuplicateKeyError(error)) return null;
  const candidate = error as { sqlMessage?: string; message?: string; cause?: { sqlMessage?: string; message?: string } };
  const message = candidate.sqlMessage || candidate.message || candidate.cause?.sqlMessage || candidate.cause?.message || "";
  const match = message.match(/(?:for key|key)\s+['`"]?(?:[^.'`"]+\.)?([^'`"\s]+)['`"]?/i);
  return match?.[1] ?? null;
}

export function isDuplicateConstraint(error: unknown, constraint: string): boolean {
  return duplicateConstraint(error)?.toLowerCase() === constraint.toLowerCase();
}

export async function withPublicCodeRetry<T>(operation: (publicCode: string) => Promise<T>, options: { attempts?: number; generate?: () => string } = {}): Promise<T> {
  const attempts = options.attempts ?? 5;
  const generate = options.generate ?? (() => generateConversationPublicCode());
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(generate()); }
    catch (error) {
      if (!isDuplicateConstraint(error, "uq_mdc_public_code") || attempt + 1 === attempts) throw error;
    }
  }
  throw new Error("PUBLIC_CODE_RETRY_EXHAUSTED");
}
