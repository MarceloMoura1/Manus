import { randomUUID } from "crypto";
import { getDb } from "./db";
import { megadeskDomainBotScripts as megadeskBotScripts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

export async function createBotScript(clientId: string, data: {
  name: string;
  description?: string;
  systemPrompt: string;
  initialMessage?: string;
}) {
  const db = getDb();
  const scriptId = randomUUID();
  
  await db.insert(megadeskBotScripts).values({
    scriptId,
    clientId,
    name: data.name,
    description: data.description || "",
    systemPrompt: data.systemPrompt,
    initialMessage: data.initialMessage ?? "",
    active: 0,
  });

  return scriptId;
}

export async function getBotScripts(clientId: string) {
  const db = getDb();
  const scripts = await db
    .select({
      scriptId: megadeskBotScripts.scriptId,
      clientId: megadeskBotScripts.clientId,
      name: megadeskBotScripts.name,
      description: megadeskBotScripts.description,
      initialMessage: megadeskBotScripts.initialMessage,
      active: megadeskBotScripts.active,
      createdAt: megadeskBotScripts.createdAt,
      updatedAt: megadeskBotScripts.updatedAt,
    })
    .from(megadeskBotScripts)
    .where(eq(megadeskBotScripts.clientId, clientId));

  return scripts;
}

export async function getBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  const script = await db
    .select()
    .from(megadeskBotScripts)
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    )
    .limit(1);

  return script[0];
}

export async function updateBotScript(
  clientId: string,
  scriptId: string,
  data: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    initialMessage?: string;
    isActive?: boolean;
  }
) {
  const db = getDb();
  const updates: Partial<typeof megadeskBotScripts.$inferInsert> = {
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  if (data.name !== undefined) updates.name = data.name;
  if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
  if (data.description !== undefined) updates.description = data.description;
  if (data.initialMessage !== undefined) updates.initialMessage = data.initialMessage;
  if (data.isActive !== undefined) updates.active = data.isActive ? 1 : 0;

  await db
    .update(megadeskBotScripts)
    .set(updates)
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function deleteBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  await db
    .delete(megadeskBotScripts)
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function activateBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  // Desativar todos os outros scripts do cliente
  await db
    .update(megadeskBotScripts)
    .set({ active: 0 })
    .where(eq(megadeskBotScripts.clientId, clientId));

  // Ativar o script selecionado
  await db
    .update(megadeskBotScripts)
    .set({ active: 1, updatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") })
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function deactivateBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  await db
    .update(megadeskBotScripts)
    .set({ active: 0, updatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") })
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function getActiveBotScript(clientId: string) {
  const db = getDb();
  const script = await db
    .select()
    .from(megadeskBotScripts)
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.active, 1)
      )
    )
    .limit(1);

  return script[0];
}
