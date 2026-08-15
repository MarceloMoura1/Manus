/**
 * WhatsApp Module — Repository: WaAccount
 * Operações de banco para contas WhatsApp Business.
 * Todas as queries filtram por clientId (isolamento multiempresa).
 */
import { getLazyDb } from "../../../db";
import { waAccounts } from "../../../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { WaAccountRecord, CreateWaAccountInput } from "../types";
import { parseDatabaseTimestamp } from "./timestamp";

const db = getLazyDb();
type AccountRow = typeof waAccounts.$inferSelect;

function toAccountRecord(row: AccountRow): WaAccountRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    displayName: row.displayName,
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    accessToken: row.accessToken,
    webhookVerifyToken: row.webhookVerifyToken,
    status: row.status,
    createdAt: parseDatabaseTimestamp(row.createdAt, "wa_accounts.created_at"),
    updatedAt: parseDatabaseTimestamp(row.updatedAt, "wa_accounts.updated_at"),
  };
}

function databaseTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

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

  if (!row) throw new Error("Conta recém-criada não foi encontrada.");
  return toAccountRecord(row);
}

export async function listWaAccounts(clientId: string): Promise<WaAccountRecord[]> {
  const rows = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.clientId, clientId));
  return rows.map(toAccountRecord);
}

export async function getWaAccountById(id: string, clientId: string): Promise<WaAccountRecord | null> {
  const [row] = await db
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
  return row ? toAccountRecord(row) : null;
}

export async function getWaAccountByPhoneNumberId(phoneNumberId: string): Promise<WaAccountRecord | null> {
  const rows = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.phoneNumberId, phoneNumberId))
    .limit(2);
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error("WA_ACCOUNT_RESOLUTION_AMBIGUOUS");
  return toAccountRecord(rows[0]);
}

export async function updateWaAccountStatus(id: string, clientId: string, status: "active" | "inactive" | "error"): Promise<void> {
  await db
    .update(waAccounts)
    .set({ status, updatedAt: databaseTimestamp() })
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}

export async function updateWaAccount(
  id: string,
  clientId: string,
  data: Partial<{ displayName: string; accessToken: string; status: "active" | "inactive" | "error" }>
): Promise<void> {
  await db
    .update(waAccounts)
    .set({ ...data, updatedAt: databaseTimestamp() })
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}

export async function deleteWaAccount(id: string, clientId: string): Promise<void> {
  await db
    .delete(waAccounts)
    .where(and(eq(waAccounts.id, id), eq(waAccounts.clientId, clientId)));
}
