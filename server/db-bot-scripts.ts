import { randomUUID } from "crypto";
import { getDb } from "./db";
// TODO: Implementar tabela megadeskBotScripts no schema
import { eq, and } from "drizzle-orm";

export async function createBotScript(clientId: string, data: {
  name: string;
  description?: string;
  systemPrompt: string;
  initialMessage?: string;
}) {
  const db = await getDb();
  const scriptId = randomUUID();
  
  await db.insert(megadeskBotScripts).values({
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
  const db = await getDb();
  const scripts = await db
    .select()
    .from(megadeskBotScripts)
    .where(eq(megadeskBotScripts.clientId, clientId));

  return scripts;
}

export async function getBotScript(clientId: string, scriptId: string) {
  const db = await getDb();
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
  const db = await getDb();
  
  await db
    .update(megadeskBotScripts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function deleteBotScript(clientId: string, scriptId: string) {
  const db = await getDb();
  
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
  const db = await getDb();
  
  // Desativar todos os outros scripts do cliente
  await db
    .update(megadeskBotScripts)
    .set({ isActive: false })
    .where(eq(megadeskBotScripts.clientId, clientId));

  // Ativar o script selecionado
  await db
    .update(megadeskBotScripts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function deactivateBotScript(clientId: string, scriptId: string) {
  const db = await getDb();
  
  await db
    .update(megadeskBotScripts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.scriptId, scriptId)
      )
    );
}

export async function getActiveBotScript(clientId: string) {
  const db = await getDb();
  const script = await db
    .select()
    .from(megadeskBotScripts)
    .where(
      and(
        eq(megadeskBotScripts.clientId, clientId),
        eq(megadeskBotScripts.isActive, true)
      )
    )
    .limit(1);

  return script[0];
}
