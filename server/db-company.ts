/**
 * Helpers para gerenciar configurações da empresa por cliente
 */
import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";

interface CompanySettings {
  id: string;
  clientId: string;
  companyName?: string;
  logoUrl?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  primaryWhatsapp?: string;
  address?: string;
  businessHoursStart?: string;
  businessHoursEnd?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Buscar configurações da empresa
 */
export async function getCompanySettings(clientId: string): Promise<CompanySettings | null> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT * FROM megadesk_company_settings WHERE client_id = ${clientId}`
  );
  
  if (!result || !Array.isArray(result) || (result as any[]).length === 0) return null;
  
  const row = result[0] as any;
  return {
    id: row.id,
    clientId: row.client_id,
    companyName: row.company_name,
    logoUrl: row.logo_url,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    primaryWhatsapp: row.primary_whatsapp,
    address: row.address,
    businessHoursStart: row.business_hours_start,
    businessHoursEnd: row.business_hours_end,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Salvar ou atualizar configurações da empresa
 */
export async function saveCompanySettings(
  clientId: string,
  data: Partial<CompanySettings>
): Promise<CompanySettings | null> {
  const db = getDb();
  const existing = await getCompanySettings(clientId);

  if (existing) {
    // Atualizar
    await db.execute(
      sql`UPDATE megadesk_company_settings SET 
        company_name = ${data.companyName}, 
        logo_url = ${data.logoUrl}, 
        primary_email = ${data.primaryEmail}, 
        primary_phone = ${data.primaryPhone}, 
        primary_whatsapp = ${data.primaryWhatsapp}, 
        address = ${data.address}, 
        business_hours_start = ${data.businessHoursStart}, 
        business_hours_end = ${data.businessHoursEnd},
        updated_at = NOW()
      WHERE client_id = ${clientId}`
    );
  } else {
    // Criar novo
    const id = uuidv4();
    await db.execute(
      sql`INSERT INTO megadesk_company_settings 
        (id, client_id, company_name, logo_url, primary_email, primary_phone, primary_whatsapp, address, business_hours_start, business_hours_end)
      VALUES (${id}, ${clientId}, ${data.companyName}, ${data.logoUrl}, ${data.primaryEmail}, ${data.primaryPhone}, ${data.primaryWhatsapp}, ${data.address}, ${data.businessHoursStart}, ${data.businessHoursEnd})`
    );
  }

  return await getCompanySettings(clientId);
}
