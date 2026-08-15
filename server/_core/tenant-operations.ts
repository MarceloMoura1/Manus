/**
 * Operações de Tenant
 * Funções para gerenciar tenants (criar, atualizar, deletar)
 */

import { createTenantDatabase, generateTenantDatabaseName } from "./tenant-db-manager";
import { getDb } from "../db";
import { megadeskDomainClients } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

interface CreateTenantInput {
  company: string;
  contact: string;
  email: string;
  phone: string;
  cnpj?: string;
  plan: string;
  maxUsers?: number;
}

interface TenantInfo {
  clientId: string;
  databaseName: string;
  company: string;
  status: string;
  accessReleased: number;
}

/**
 * Cria um novo tenant com banco de dados isolado
 */
export async function createNewTenant(input: CreateTenantInput): Promise<TenantInfo> {
  try {
    const db = getDb();
    if (!db) throw new Error("Database não disponível");

    // Gera IDs únicos
    const clientId = `mdsk_${nanoid(12)}`;
    const internalId = nanoid(16);

    // Cria banco de dados do tenant
    const databaseName = await createTenantDatabase(clientId);

    // Gera token de API
    const apiToken = `mdsk_live_${clientId}_${Math.random().toString(16).slice(2, 14)}`;

    // Insere registro na tabela de controle (banco principal)
    await db.insert(megadeskDomainClients).values({
      clientId,
      internalId,
      tenantDatabaseName: databaseName,
      company: input.company,
      contact: input.contact,
      email: input.email,
      phone: input.phone,
      cnpj: input.cnpj || "",
      plan: input.plan,
      maxUsers: input.maxUsers || 5,
      statusType: "test",
      status: "setup",
      accessReleased: 0,
      apiToken,
      modulesJson: JSON.stringify([]),
      integrationsJson: JSON.stringify({}),
    });

    console.log(`✅ Tenant criado: ${clientId} (DB: ${databaseName})`);

    return {
      clientId,
      databaseName,
      company: input.company,
      status: "setup",
      accessReleased: 0,
    };
  } catch (error) {
    console.error("❌ Erro ao criar tenant:", error);
    throw error;
  }
}

/**
 * Libera acesso de um tenant
 */
export async function releaseTenantAccess(clientId: string): Promise<void> {
  void clientId;
  throw new Error("Fluxo legado bloqueado: use releaseTenantOperationalAccess no serviço de lifecycle.");
}

/**
 * Pausa acesso de um tenant
 */
export async function pauseTenantAccess(clientId: string): Promise<void> {
  void clientId;
  throw new Error("Fluxo legado bloqueado: use quarantineTenant no serviço de lifecycle.");
}

/**
 * Obtém informações de um tenant
 */
export async function getTenantInfo(clientId: string): Promise<TenantInfo | null> {
  try {
    const db = getDb();
    if (!db) throw new Error("Database não disponível");

    const result = await db
      .select()
      .from(megadeskDomainClients)
      .where(eq(megadeskDomainClients.clientId, clientId))
      .limit(1);

    if (!result[0]) return null;

    const client = result[0];

    return {
      clientId: client.clientId,
      databaseName: client.tenantDatabaseName,
      company: client.company,
      status: client.status,
      accessReleased: client.accessReleased,
    };
  } catch (error) {
    console.error("❌ Erro ao obter info do tenant:", error);
    return null;
  }
}

/**
 * Coloca um tenant em quarentena recuperável, preservando registro e banco físico.
 */
export async function deleteTenant(clientId: string): Promise<void> {
  void clientId;
  throw new Error("Fluxo legado bloqueado: use o serviço único de tenant lifecycle.");
}

/**
 * Lista todos os tenants
 */
export async function listAllTenants(): Promise<TenantInfo[]> {
  try {
    const db = getDb();
    if (!db) throw new Error("Database não disponível");

    const results = await db.select().from(megadeskDomainClients);

    return results.map((client) => ({
      clientId: client.clientId,
      databaseName: client.tenantDatabaseName,
      company: client.company,
      status: client.status,
      accessReleased: client.accessReleased,
    }));
  } catch (error) {
    console.error("❌ Erro ao listar tenants:", error);
    return [];
  }
}
