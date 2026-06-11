/**
 * Helpers para gerenciar configurações de usuário (notificações, atalhos)
 * Isolamento de tenant garantido em todas as operações
 */
import { getDb } from "./db";
import { megadeskUserSettings, megadeskUserShortcuts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const db = getDb();

/**
 * Buscar ou criar configurações padrão do usuário
 */
export async function getUserSettings(clientId: string, userId: string) {
  const existing = await db
    .select()
    .from(megadeskUserSettings)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Criar configurações padrão
  const id = uuidv4();
  await (db.insert(megadeskUserSettings) as any).values({
    id,
    clientId,
    userId,
    notificationsEnabled: 1,
    soundEnabled: 1,
    soundVolume: 70,
    desktopNotificationsEnabled: 1,
    whatsappNotificationsEnabled: 1,
    ticketsNotificationsEnabled: 1,
    iaNotificationsEnabled: 1,
    erpNotificationsEnabled: 1,
    trackingNotificationsEnabled: 1,
    showMessagePreview: 1,
    autoResponseEnabled: 0,
  });

  return await db
    .select()
    .from(megadeskUserSettings)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)))
    .limit(1)
    .then((rows: any[]) => rows[0]);
}

/**
 * Atualizar configurações de notificações do usuário
 */
export async function updateUserNotificationSettings(
  clientId: string,
  userId: string,
  updates: Partial<{
    notificationsEnabled: number | undefined; // tinyint
    soundEnabled: number | undefined; // tinyint
    soundVolume: number;
    muteUntil: Date | null;
    desktopNotificationsEnabled: number | undefined; // tinyint
    whatsappNotificationsEnabled: number | undefined; // tinyint
    ticketsNotificationsEnabled: number | undefined; // tinyint
    iaNotificationsEnabled: number | undefined; // tinyint
    erpNotificationsEnabled: number | undefined; // tinyint
    trackingNotificationsEnabled: number | undefined; // tinyint
    showMessagePreview: number | undefined; // tinyint
  }>
) {
  await db
    .update(megadeskUserSettings)
    .set(updates as any)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)));

  return await getUserSettings(clientId, userId);
}

/**
 * Atualizar configurações de atendimento (resposta automática)
 */
export async function updateUserAttendanceSettings(
  clientId: string,
  userId: string,
  updates: Partial<{
    autoResponseEnabled: number | undefined; // tinyint
    autoResponseMessage: string | null;
  }>
) {
  await db
    .update(megadeskUserSettings)
    .set(updates as any)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)));

  return await getUserSettings(clientId, userId);
}

/**
 * Silenciar notificações por tempo determinado
 */
export async function muteNotifications(clientId: string, userId: string, minutes: number) {
  const muteUntil = new Date(Date.now() + minutes * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  await db
    .update(megadeskUserSettings)
    .set({ muteUntil })
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)));

  return await getUserSettings(clientId, userId);
}

/**
 * Listar todos os atalhos do usuário
 */
export async function getUserShortcuts(clientId: string, userId: string) {
  return await db
    .select()
    .from(megadeskUserShortcuts)
    .where(and(eq(megadeskUserShortcuts.clientId, clientId), eq(megadeskUserShortcuts.userId, userId)))
    .orderBy(megadeskUserShortcuts.createdAt);
}

/**
 * Criar novo atalho de mensagem
 */
export async function createUserShortcut(
  clientId: string,
  userId: string,
  shortcutKey: string,
  shortcutMessage: string
) {
  const id = uuidv4();

  await db.insert(megadeskUserShortcuts).values({
    id,
    clientId,
    userId,
    shortcutKey: shortcutKey.toLowerCase().replace(/[^a-z0-9_]/g, ""),
    shortcutMessage,
  });

  return await db
    .select()
    .from(megadeskUserShortcuts)
    .where(eq(megadeskUserShortcuts.id, id))
    .limit(1)
    .then((rows: any[]) => rows[0]);
}

/**
 * Atualizar atalho existente
 */
export async function updateUserShortcut(
  clientId: string,
  userId: string,
  shortcutKey: string,
  shortcutMessage: string
) {
  const normalizedKey = shortcutKey.toLowerCase().replace(/[^a-z0-9_]/g, "");

  await db
    .update(megadeskUserShortcuts)
    .set({ shortcutMessage })
    .where(
      and(
        eq(megadeskUserShortcuts.clientId, clientId),
        eq(megadeskUserShortcuts.userId, userId),
        eq(megadeskUserShortcuts.shortcutKey, normalizedKey)
      )
    );

  return await db
    .select()
    .from(megadeskUserShortcuts)
    .where(
      and(
        eq(megadeskUserShortcuts.clientId, clientId),
        eq(megadeskUserShortcuts.userId, userId),
        eq(megadeskUserShortcuts.shortcutKey, normalizedKey)
      )
    )
    .limit(1)
    .then((rows: any[]) => rows[0]);
}

/**
 * Deletar atalho
 */
export async function deleteUserShortcut(clientId: string, userId: string, shortcutKey: string) {
  const normalizedKey = shortcutKey.toLowerCase().replace(/[^a-z0-9_]/g, "");

  await db
    .delete(megadeskUserShortcuts)
    .where(
      and(
        eq(megadeskUserShortcuts.clientId, clientId),
        eq(megadeskUserShortcuts.userId, userId),
        eq(megadeskUserShortcuts.shortcutKey, normalizedKey)
      )
    );

  return { success: true };
}
