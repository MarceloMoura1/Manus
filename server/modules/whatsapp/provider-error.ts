import { randomUUID } from "node:crypto";

export type WhatsAppProviderFailureClass =
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_BAD_RESPONSE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNKNOWN";

export type WhatsAppProviderDiagnostic = {
  correlationId: string;
  failureClass: WhatsAppProviderFailureClass;
  operation: string;
  stage: string;
  status: number | null;
};

function safeStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = Number("status" in error ? (error as { status?: unknown }).status
    : "code" in error ? (error as { code?: unknown }).code : null);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function classifyWhatsAppProviderFailure(error: unknown): Pick<WhatsAppProviderDiagnostic, "failureClass" | "status"> {
  const status = safeStatus(error);
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (status === 401 || status === 403) return { failureClass: "PROVIDER_AUTH_FAILED", status };
  if (status === 429) return { failureClass: "PROVIDER_RATE_LIMITED", status };
  if (name === "TimeoutError" || /\b(?:timeout|timed out|ETIMEDOUT)\b/i.test(message)) {
    return { failureClass: "PROVIDER_TIMEOUT", status };
  }
  if ((status !== null && status >= 500) || /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND)\b/i.test(message)) {
    return { failureClass: "PROVIDER_UNAVAILABLE", status };
  }
  if (status !== null && status >= 400) return { failureClass: "PROVIDER_BAD_RESPONSE", status };
  return { failureClass: "PROVIDER_UNKNOWN", status };
}

export function whatsappProviderDiagnostic(error: unknown, operation: string, stage: string): WhatsAppProviderDiagnostic {
  return { correlationId: randomUUID(), ...classifyWhatsAppProviderFailure(error),
    operation: operation.slice(0, 80), stage: stage.slice(0, 80) };
}

export function whatsappProviderPublicMessage(diagnostic: WhatsAppProviderDiagnostic): string {
  const messages: Record<WhatsAppProviderFailureClass, string> = {
    PROVIDER_AUTH_FAILED: "O provedor recusou as credenciais configuradas.",
    PROVIDER_UNAVAILABLE: "O provedor de WhatsApp está temporariamente indisponível.",
    PROVIDER_RATE_LIMITED: "O provedor limitou temporariamente as tentativas.",
    PROVIDER_BAD_RESPONSE: "O provedor rejeitou a solicitação.",
    PROVIDER_TIMEOUT: "O provedor não respondeu dentro do tempo esperado.",
    PROVIDER_UNKNOWN: "Não foi possível concluir a operação no provedor.",
  };
  return `${messages[diagnostic.failureClass]} Referência: ${diagnostic.correlationId}`;
}

export function whatsappProviderPersistedError(diagnostic: WhatsAppProviderDiagnostic): string {
  return `${diagnostic.failureClass}:${diagnostic.operation}:${diagnostic.stage}:${diagnostic.correlationId}`;
}

export function logWhatsAppProviderFailure(label: string, diagnostic: WhatsAppProviderDiagnostic): void {
  console.warn(label, diagnostic);
}
