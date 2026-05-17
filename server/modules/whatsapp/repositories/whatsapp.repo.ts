/**
 * WhatsApp Module — Repository: WaAccount
 * Operações de banco para contas WhatsApp Business.
 * Todas as queries filtram por clientId (isolamento multiempresa).
 */
import { getDb } from "../../../db";
import { waAccounts } from "../../../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { WaAccountRecord, CreateWaAccountInput } from "../types";

const db = getDb();

function generateVerifyToken(): string {
  return `vt_${randomUUID().replace(/-/g, "")}`;
}

export async function createWaAccount(input: CreateWaAccountInput): Promise<WaAccountRecord> {
  const id = randomUUID();
  const webhookVerifyToken = generateVerifyToken();

  await db.insert(waAccounts).values({
    id,
    clientId: input.clientId,
    displayName: input.displayName,
    phoneNumberId: input.phoneNumberId,
    businessAccountId: input.businessAccountId,
    accessToken: input.accessToken,
    webhookVerifyToken,
    status: "inactive",
  });

  const [row] = await db
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, input.clientId)));

  return row as WaAccountRecord;
}

export async function listWaAccounts(clientId: string): Promise<WaAccountRecord[]> {
  const rows = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.clientId, clientId));
  return rows as WaAccountRecord[];
}

export async function getWaAccountById(id: string, clientId: string): Promise<WaAccountRecord | null> {
  const [row] = await db
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
  return (row as WaAccountRecord) ?? null;
}

export async function getWaAccountByPhoneNumberId(phoneNumberId: string): Promise<WaAccountRecord | null> {
  const [row] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.phoneNumberId, phoneNumberId));
  return (row as WaAccountRecord) ?? null;
}

export async function updateWaAccountStatus(id: string, clientId: string, status: "active" | "inactive" | "error"): Promise<void> {
  await db
    .update(waAccounts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}

export async function updateWaAccount(
  id: string,
  clientId: string,
  data: Partial<{ displayName: string; accessToken: string; status: "active" | "inactive" | "error" }>
): Promise<void> {
  await db
    .update(waAccounts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}

export async function deleteWaAccount(id: string, clientId: string): Promise<void> {
  await db
    .delete(waAccounts)
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}
