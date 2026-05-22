import { getDb } from "./db";
import { megadeskDomainBotScripts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// TODO: Usar megadeskDomainBotScripts ao invés de megadeskBotScripts

export async function createBotScript(clientId: string, data: {
  name: string;
  description?: string;
  systemPrompt: string;
  initialMessage?: string;
}) {
  const db = getDb();
  const scriptId = randomUUID();
  
  await db.insert(megadeskDomainBotScripts).values({
    scriptId,
    clientId,
    name: data.name,
    description: data.description,
    systemPrompt: data.systemPrompt,
    initialMessage: data.initialMessage,
    isActive: false,
  });

  return scriptId;
}

export async function getBotScripts(clientId: string) {
  const db = getDb();
  const scripts = await db
    .select()
    .from(megadeskDomainBotScripts)
    .where(eq(megadeskDomainBotScripts.clientId, clientId));
  
  return scripts;
}

export async function updateBotScript(clientId: string, scriptId: string, data: {
  name?: string;
  description?: string;
  systemPrompt?: string;
  initialMessage?: string;
  isActive?: boolean;
}) {
  const db = getDb();
  
  await db.update(megadeskDomainBotScripts)
    .set(data)
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.scriptId, scriptId)
    ));
}

export async function deleteBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  await db.delete(megadeskDomainBotScripts)
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.scriptId, scriptId)
    ));
}

export async function activateBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  // Desativar todos os scripts deste cliente
  await db.update(megadeskDomainBotScripts)
    .set({ isActive: false })
    .where(eq(megadeskDomainBotScripts.clientId, clientId));
  
  // Ativar o script selecionado
  await db.update(megadeskDomainBotScripts)
    .set({ isActive: true })
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.scriptId, scriptId)
    ));
}

export async function deactivateBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  await db.update(megadeskDomainBotScripts)
    .set({ isActive: false })
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.scriptId, scriptId)
    ));
}

export async function getActiveBotScript(clientId: string) {
  const db = getDb();
  
  const scripts = await db
    .select()
    .from(megadeskDomainBotScripts)
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.isActive, true)
    ))
    .limit(1);
  
  return scripts[0] || null;
}

export async function getBotScript(clientId: string, scriptId: string) {
  const db = getDb();
  
  const scripts = await db
    .select()
    .from(megadeskDomainBotScripts)
    .where(and(
      eq(megadeskDomainBotScripts.clientId, clientId),
      eq(megadeskDomainBotScripts.scriptId, scriptId)
    ))
    .limit(1);
  
  return scripts[0] || null;
}
