/**
 * Helpers para gerenciar configurações de usuário (notificações, atalhos)
 * Isolamento de tenant garantido em todas as operações
 */
import { db } from "./_core/db";
import { megadeskUserSettings, megadeskUserShortcuts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

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
  await db.insert(megadeskUserSettings).values({
    id,
    clientId,
    userId,
    notificationsEnabled: true,
    soundEnabled: true,
    soundVolume: 70,
    desktopNotificationsEnabled: true,
    whatsappNotificationsEnabled: true,
    ticketsNotificationsEnabled: true,
    iaNotificationsEnabled: true,
    erpNotificationsEnabled: true,
    trackingNotificationsEnabled: true,
    showMessagePreview: true,
    autoResponseEnabled: false,
  });

  return await db
    .select()
    .from(megadeskUserSettings)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Atualizar configurações de notificações do usuário
 */
export async function updateUserNotificationSettings(
  clientId: string,
  userId: string,
  updates: Partial<{
    notificationsEnabled: boolean;
    soundEnabled: boolean;
    soundVolume: number;
    muteUntil: Date | null;
    desktopNotificationsEnabled: boolean;
    whatsappNotificationsEnabled: boolean;
    ticketsNotificationsEnabled: boolean;
    iaNotificationsEnabled: boolean;
    erpNotificationsEnabled: boolean;
    trackingNotificationsEnabled: boolean;
    showMessagePreview: boolean;
  }>
) {
  await db
    .update(megadeskUserSettings)
    .set(updates)
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
    autoResponseEnabled: boolean;
    autoResponseMessage: string | null;
  }>
) {
  await db
    .update(megadeskUserSettings)
    .set(updates)
    .where(and(eq(megadeskUserSettings.clientId, clientId), eq(megadeskUserSettings.userId, userId)));

  return await getUserSettings(clientId, userId);
}

/**
 * Silenciar notificações por tempo determinado
 */
export async function muteNotifications(clientId: string, userId: string, minutes: number) {
  const muteUntil = new Date(Date.now() + minutes * 60 * 1000);

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
    .then((rows) => rows[0]);
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
    .then((rows) => rows[0]);
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
