/**
 * WhatsApp Module — WhatsApp Account Service
 * Lógica de negócio para gerenciamento de contas WhatsApp Business.
 */
import {
  createWaAccount,
  listWaAccounts,
  getWaAccountById,
  updateWaAccount,
  updateWaAccountStatus,
  deleteWaAccount,
} from "../repositories/whatsapp.repo";
import { getPhoneNumberInfo } from "../meta/graph-api";
import { TRPCError } from "@trpc/server";
import type { CreateWaAccountInput, WaAccountRecord } from "../types";
import { logWhatsAppProviderFailure, whatsappProviderDiagnostic, whatsappProviderPublicMessage } from "../provider-error";

export type WhatsAppProviderFailureClass =
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_BAD_RESPONSE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNKNOWN";

export function classifyWhatsAppProviderFailure(error: unknown): {
  failureClass: WhatsAppProviderFailureClass;
  status: number | null;
} {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : null;
  const safeStatus = status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (safeStatus === 401 || safeStatus === 403) return { failureClass: "PROVIDER_AUTH_FAILED", status: safeStatus };
  if (safeStatus === 429) return { failureClass: "PROVIDER_RATE_LIMITED", status: safeStatus };
  if (name === "TimeoutError" || /\b(?:timeout|timed out|ETIMEDOUT)\b/i.test(message)) {
    return { failureClass: "PROVIDER_TIMEOUT", status: safeStatus };
  }
  if ((safeStatus !== null && safeStatus >= 500) || /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND)\b/i.test(message)) {
    return { failureClass: "PROVIDER_UNAVAILABLE", status: safeStatus };
  }
  if (safeStatus !== null && safeStatus >= 400) return { failureClass: "PROVIDER_BAD_RESPONSE", status: safeStatus };
  return { failureClass: "PROVIDER_UNKNOWN", status: safeStatus };
}

function providerFailurePublicMessage(failureClass: WhatsAppProviderFailureClass, correlationId: string): string {
  const messages: Record<WhatsAppProviderFailureClass, string> = {
    PROVIDER_AUTH_FAILED: "O provedor recusou as credenciais configuradas.",
    PROVIDER_UNAVAILABLE: "O provedor de WhatsApp está temporariamente indisponível.",
    PROVIDER_RATE_LIMITED: "O provedor limitou temporariamente as tentativas de conexão.",
    PROVIDER_BAD_RESPONSE: "O provedor rejeitou os dados de conexão informados.",
    PROVIDER_TIMEOUT: "O provedor não respondeu dentro do tempo esperado.",
    PROVIDER_UNKNOWN: "Não foi possível validar a conta no provedor.",
  };
  return `${messages[failureClass]} Referência: ${correlationId}`;
}

type SafeWaAccount = Omit<WaAccountRecord, "accessToken" | "webhookVerifyToken"> & {
  accessTokenConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
};

function sanitizeAccount(account: WaAccountRecord): SafeWaAccount {
  const { accessToken, webhookVerifyToken, ...safe } = account;
  return {
    ...safe,
    accessTokenConfigured: accessToken.length > 0,
    webhookVerifyTokenConfigured: webhookVerifyToken.length > 0,
  };
}

export async function connectAccount(input: CreateWaAccountInput) {
  // Verificar se o token é válido buscando info do número
  try {
    const info = await getPhoneNumberInfo(input.phoneNumberId, input.accessToken);
    const account = await createWaAccount({
      ...input,
      displayName: input.displayName || info.verified_name || info.display_phone_number,
    });

    // Ativar a conta após verificação bem-sucedida
    await updateWaAccountStatus(account.id, input.clientId, "active");

    return sanitizeAccount({ ...account, status: "active" as const });
  } catch (err) {
    const diagnostic = whatsappProviderDiagnostic(err, "connect_account", "provider_validation");
    logWhatsAppProviderFailure("[WhatsApp Account] Falha sanitizada ao conectar provider.", diagnostic);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: whatsappProviderPublicMessage(diagnostic),
    });
  }
}

export async function listAccounts(clientId: string) {
  return (await listWaAccounts(clientId)).map(sanitizeAccount);
}

export async function getAccount(clientId: string, accountId: string) {
  const account = await getWaAccountById(accountId, clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });
  // Segredos de provider e de verificacao permanecem exclusivamente no backend.
  return sanitizeAccount(account);
}

export async function updateAccount(
  clientId: string,
  accountId: string,
  data: Partial<{ displayName: string; accessToken: string }>
) {
  const account = await getWaAccountById(accountId, clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  await updateWaAccount(accountId, clientId, data);
  return { success: true };
}

export async function disconnectAccount(clientId: string, accountId: string) {
  const account = await getWaAccountById(accountId, clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  await updateWaAccountStatus(accountId, clientId, "inactive");
  return { success: true };
}

export async function removeAccount(clientId: string, accountId: string) {
  const account = await getWaAccountById(accountId, clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  await deleteWaAccount(accountId, clientId);
  return { success: true };
}
