/**
 * CAMADA DE SINCRONIZAÇÃO MEGADESK ↔ MEGAADMIN
 * 
 * Responsável por sincronizar dados de clientes, usuários e permissões
 * entre MegaAdmin (fonte de verdade) e MegaDesk (consumidor).
 * 
 * REGRA CRÍTICA: O banco de dados é a fonte de verdade.
 * A memória é apenas cache para performance.
 */

import { getDb } from './db';
import {
  megadeskDomainClientUsers,
  megadeskCompanySettings,
} from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

/**
 * Sincroniza dados da empresa do MegaAdmin para o banco de dados do MegaDesk
 * Chamado sempre que dados da empresa são atualizados no MegaAdmin
 */
export async function syncClientDataToDb(clientData: {
  clientId: string;
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  businessHours?: string;
  logoUrl?: string;
  status: 'active' | 'setup' | 'paused';
  accessReleased: boolean;
  maxUsers: number;
  plan: string;
  modules: string[];
}) {
  try {
    const db = getDb();
    
    // Verificar se já existe
    const existing = await db
      .select()
      .from(megadeskCompanySettings)
      .where(eq(megadeskCompanySettings.clientId, clientData.clientId))
      .limit(1);

    if (existing.length > 0) {
      // Atualizar
      await db
        .update(megadeskCompanySettings)
        .set({
          companyName: clientData.company,
          email: clientData.email || '',
          phone: clientData.phone || '',
          whatsapp: clientData.whatsapp || '',
          address: clientData.address || '',
          businessHours: clientData.businessHours || '',
          logoUrl: clientData.logoUrl || '',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(megadeskCompanySettings.clientId, clientData.clientId));
    } else {
      // Criar
      await db.insert(megadeskCompanySettings).values({
        settingId: `setting-${Date.now()}`,
        clientId: clientData.clientId,
        companyName: clientData.company,
        email: clientData.email || '',
        phone: clientData.phone || '',
        whatsapp: clientData.whatsapp || '',
        address: clientData.address || '',
        businessHours: clientData.businessHours || '',
        logoUrl: clientData.logoUrl || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`[SYNC] Dados da empresa sincronizados: ${clientData.clientId}`);
  } catch (error) {
    console.error(`[SYNC ERROR] Falha ao sincronizar dados da empresa ${clientData.clientId}:`, error);
    throw error;
  }
}

/**
 * Sincroniza usuários da equipe do MegaAdmin para o banco de dados do MegaDesk
 * Chamado sempre que usuários são adicionados/removidos/editados no MegaAdmin
 */
export async function syncTeamUsersToDb(clientId: string, users: Array<{
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'agent' | 'viewer';
  status: 'active' | 'blocked';
  permissions?: string[];
}>) {
  try {
    const db = getDb();

    // Buscar usuários existentes no banco
    const existingUsers = await db
      .select()
      .from(megadeskDomainClientUsers)
      .where(eq(megadeskDomainClientUsers.clientId, clientId));

    const existingIds = new Set(existingUsers.map(u => u.userId));
    const incomingIds = new Set(users.map(u => u.id));

    // Remover usuários que não existem mais no MegaAdmin
    for (const existingUser of existingUsers) {
      if (!incomingIds.has(existingUser.userId)) {
        await db
          .delete(megadeskDomainClientUsers)
          .where(
            and(
              eq(megadeskDomainClientUsers.clientId, clientId),
              eq(megadeskDomainClientUsers.userId, existingUser.userId)
            )
          );
        console.log(`[SYNC] Usuário removido: ${existingUser.userId} (${clientId})`);
      }
    }

    // Atualizar ou criar usuários
    for (const user of users) {
      const permissionsJson = JSON.stringify(user.permissions || []);

      if (existingIds.has(user.id)) {
        // Atualizar
        await db
          .update(megadeskDomainClientUsers)
          .set({
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            permissionsJson,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(megadeskDomainClientUsers.clientId, clientId),
              eq(megadeskDomainClientUsers.userId, user.id)
            )
          );
        console.log(`[SYNC] Usuário atualizado: ${user.email} (${clientId})`);
      } else {
        // Criar (sem password_hash — será definido depois)
        await db.insert(megadeskDomainClientUsers).values({
          userId: user.id,
          clientId,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          permissionsJson,
          passwordHash: null, // Será definido pelo usuário depois
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        console.log(`[SYNC] Usuário criado: ${user.email} (${clientId})`);
      }
    }

    console.log(`[SYNC] Equipe sincronizada: ${clientId} (${users.length} usuários)`);
  } catch (error) {
    console.error(`[SYNC ERROR] Falha ao sincronizar equipe ${clientId}:`, error);
    throw error;
  }
}

/**
 * Valida integridade de dados — verifica se MegaAdmin e MegaDesk estão sincronizados
 */
export async function validateSyncIntegrity(clientId: string): Promise<{
  isSynced: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  
  try {
    const db = getDb();

    // Verificar se dados da empresa existem
    const companySettings = await db
      .select()
      .from(megadeskCompanySettings)
      .where(eq(megadeskCompanySettings.clientId, clientId))
      .limit(1);

    if (companySettings.length === 0) {
      issues.push(`Dados da empresa não encontrados para ${clientId}`);
    }

    // Verificar se há usuários
    const users = await db
      .select()
      .from(megadeskDomainClientUsers)
      .where(eq(megadeskDomainClientUsers.clientId, clientId));

    if (users.length === 0) {
      issues.push(`Nenhum usuário encontrado para ${clientId}`);
    }

    // Verificar se há usuários sem senha (problema crítico)
    const usersWithoutPassword = users.filter(u => !u.passwordHash);
    if (usersWithoutPassword.length > 0) {
      issues.push(
        `${usersWithoutPassword.length} usuário(s) sem senha configurada: ${usersWithoutPassword.map(u => u.email).join(', ')}`
      );
    }

    return {
      isSynced: issues.length === 0,
      issues,
    };
  } catch (error) {
    console.error(`[SYNC ERROR] Falha ao validar integridade ${clientId}:`, error);
    return {
      isSynced: false,
      issues: [`Erro ao validar integridade: ${error instanceof Error ? error.message : 'Desconhecido'}`],
    };
  }
}

/**
 * Obtém dados sincronizados do cliente do banco de dados
 */
export async function getSyncedClientData(clientId: string) {
  try {
    const db = getDb();

    const companySettings = await db
      .select()
      .from(megadeskCompanySettings)
      .where(eq(megadeskCompanySettings.clientId, clientId))
      .limit(1);

    if (companySettings.length === 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Dados da empresa não encontrados para ${clientId}`,
      });
    }

    const users = await db
      .select()
      .from(megadeskDomainClientUsers)
      .where(eq(megadeskDomainClientUsers.clientId, clientId));

    return {
      companySettings: companySettings[0],
      users: users.map(u => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        permissions: u.permissionsJson ? JSON.parse(u.permissionsJson) : [],
      })),
    };
  } catch (error) {
    console.error(`[SYNC ERROR] Falha ao obter dados sincronizados ${clientId}:`, error);
    throw error;
  }
}
