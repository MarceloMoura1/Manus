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
import type { CreateWaAccountInput } from "../types";

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

    return { ...account, status: "active" as const };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Token inválido";
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Falha ao conectar conta WhatsApp: ${errMsg}`,
    });
  }
}

export async function listAccounts(clientId: string) {
  return listWaAccounts(clientId);
}

export async function getAccount(clientId: string, accountId: string) {
  const account = await getWaAccountById(accountId, clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });
  // Nunca retornar o access_token completo para o frontend
  return { ...account, accessToken: `${account.accessToken.slice(0, 8)}...` };
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
