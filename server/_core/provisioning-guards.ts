const inFlight = new Map<string, Promise<unknown>>();
const recentOperations = new Map<string, number[]>();

export const MAX_USERS_PER_REQUEST = 25;
export const ADMIN_CREATE_LIMIT = 10;
export const ADMIN_CREATE_WINDOW_MS = 60_000;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeTechnicalName(value: string): string {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function tenantProvisioningKey(input: { company: string; email: string; cnpj?: string; idempotencyKey?: string }): string {
  const explicit = input.idempotencyKey?.trim();
  if (explicit) return `explicit:${explicit}`;
  return `natural:${normalizeTechnicalName(input.company)}:${normalizeEmail(input.email)}:${normalizeDigits(input.cnpj ?? "")}`;
}

export async function runIdempotent<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = operation().finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export function enforceAdministrativeRateLimit(actorId: string, now = Date.now()): void {
  const cutoff = now - ADMIN_CREATE_WINDOW_MS;
  const recent = (recentOperations.get(actorId) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= ADMIN_CREATE_LIMIT) throw new Error("ADMIN_CREATE_RATE_LIMITED");
  recent.push(now);
  recentOperations.set(actorId, recent);
}

export function assertBatchSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > MAX_USERS_PER_REQUEST) throw new Error("USER_BATCH_LIMIT_EXCEEDED");
}

export function resetProvisioningGuardsForTests(): void {
  inFlight.clear();
  recentOperations.clear();
}
