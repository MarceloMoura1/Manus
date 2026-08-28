/**
 * routers-crm.ts — Procedures tRPC para a página de Clientes (CRM)
 * O tenant é derivado exclusivamente da sessão operacional.
 */
import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listCrmClients,
  getCrmClientById,
  createCrmClient,
  updateCrmClient,
  addCrmTimeline,
  listCrmTimeline,
} from "./db-crm";
import { getPool } from "./db";
import { CUSTOMER_TYPES, parseCustomerType, customerTypeToCsv } from "../shared/crm";
import { isValidCpf, isValidCnpj } from "../shared/br-documents";

const CRM_ROLES = new Set(["admin", "manager"]);

function requireCrmAccess(ctx: {
  tenantId: string;
  operationalUserRole?: string;
  operationalPermissions?: string[];
}) {
  if (!ctx.operationalUserRole || !CRM_ROLES.has(ctx.operationalUserRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  if (ctx.operationalPermissions && !ctx.operationalPermissions.some(permission => permission === "clients" || permission === "erp")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  return ctx.tenantId;
}

function publicCrmClient(client: Record<string, unknown>) {
  const { clientId: _tenantId, ...publicClient } = client;
  return publicClient;
}

function crmClientOrNotFound<T>(client: T | undefined | null): T {
  if (!client) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
  }
  return client;
}

const crmClientInputSchema = z.object({
  customerType: z.enum(CUSTOMER_TYPES),
  companyName: z.string().min(1, "Nome do cliente é obrigatório"),
  responsibleName: z.string().optional().default(""),
  cpfCnpj: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  whatsapp: z.string().optional().default(""),
  email: z.string().optional().default(""),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().max(2).optional().default(""),
  cep: z.string().optional().default(""),
  status: z.enum(["lead", "ativo", "inativo", "cancelado", "inadimplente"]).optional().default("lead"),
  origin: z.enum(["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"]).optional().default("outro"),
  internalResponsible: z.string().optional().default(""),
  tags: z.string().optional().default(""),
  observations: z.string().optional().default(""),
  contacts: z.array(z.object({
    phone: z.string(),
    whatsapp: z.string(),
    description: z.string().optional(),
  })).optional().default([]),
}).strict();

function validateCustomerDocument(data: z.infer<typeof crmClientInputSchema>) {
  if (!data.cpfCnpj) return data;
  const valid = data.customerType === "person" ? isValidCpf(data.cpfCnpj) : isValidCnpj(data.cpfCnpj);
  if (!valid) throw new TRPCError({ code: "BAD_REQUEST", message: data.customerType === "person" ? "CPF inválido." : "CNPJ inválido." });
  return data;
}

export const crmRouter = router({
  // Listar clientes CRM do tenant
  list: megadeskProcedure
    .input(z.object({
      search: z.string().optional(),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const clients = await listCrmClients(tenantId, input.search);
      return { clients: clients.map((client) => publicCrmClient(client as unknown as Record<string, unknown>)) };
    }),

  exportCsv: megadeskProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const clients = await listCrmClients(tenantId);
      return {
        rows: clients.map((client) => ({
          companyName: client.companyName,
          customerType: client.customerType,
          tipo: customerTypeToCsv(client.customerType),
          responsibleName: client.responsibleName,
          cpfCnpj: client.cpfCnpj,
          phone: client.phone,
          whatsapp: client.whatsapp,
          email: client.email,
          address: client.address,
          city: client.city,
          state: client.state,
          cep: client.cep,
          status: client.status,
          origin: client.origin,
          observations: client.observations,
        })),
      };
    }),

  // Buscar cliente CRM por ID
  getById: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const client = crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));
      return { client: publicCrmClient(client as unknown as Record<string, unknown>) };
    }),

  // Criar novo cliente CRM
  create: megadeskProcedure
    .input(z.object({
      data: crmClientInputSchema,
    }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const result = await createCrmClient(tenantId, validateCustomerDocument(input.data));
      return { success: true, crmClientId: result.crmClientId };
    }),

  // Atualizar cliente CRM com registro de histórico na timeline
  update: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
      data: crmClientInputSchema.partial(),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const existing = crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));
      const merged = { ...existing, ...input.data };
      if (!merged.customerType) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione Pessoa ou Empresa antes de salvar." });
      validateCustomerDocument({
        companyName: merged.companyName,
        customerType: merged.customerType,
        responsibleName: merged.responsibleName ?? "", cpfCnpj: merged.cpfCnpj ?? "", phone: merged.phone ?? "", whatsapp: merged.whatsapp ?? "",
        email: merged.email ?? "", address: merged.address ?? "", city: merged.city ?? "", state: merged.state ?? "", cep: merged.cep ?? "",
        status: merged.status, origin: merged.origin, internalResponsible: merged.internalResponsible ?? "", tags: merged.tags ?? "", observations: merged.observations ?? "", contacts: input.data.contacts ?? [],
      });
      await updateCrmClient(input.crmClientId, tenantId, input.data);
      // Registrar na timeline quem editou e quando
      await addCrmTimeline(input.crmClientId, tenantId, {
        type: "edit",
        description: `Cadastro editado por ${ctx.userEmail}`,
        author: ctx.userEmail,
      });
      return { success: true };
    }),

  // Buscar chamados vinculados ao cliente CRM pelo nome/empresa
  getChamados: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const pool = getPool();
      // Buscar dados do cliente CRM para usar como filtro
      const crmClient = crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));

      const [directRows] = await pool.execute(
        `SELECT chamadoId AS chamado_id, chamadoNumber AS chamado_number,
                customerName AS customer_name, company, title, status, priority,
                createdAt AS created_at
         FROM megadesk_domain_chamados
         WHERE clientId = ? AND customerId = ?
         ORDER BY createdAt DESC LIMIT 50`,
        [tenantId, input.crmClientId]
      ) as any[];

      const searchTerms: string[] = [];
      if (crmClient.companyName) searchTerms.push(crmClient.companyName);
      if (crmClient.responsibleName) searchTerms.push(crmClient.responsibleName);
      if (crmClient.phone) searchTerms.push(crmClient.phone);
      if (crmClient.whatsapp) searchTerms.push(crmClient.whatsapp);

      if (searchTerms.length === 0 && (directRows as any[]).length === 0) return { chamados: [] };

      // Buscar chamados que correspondam ao cliente (por empresa ou nome)
      const placeholders = searchTerms.map(() => "customerName LIKE ? OR company LIKE ?").join(" OR ");
      const values: string[] = [];
      searchTerms.forEach(term => {
        values.push(`%${term}%`, `%${term}%`);
      });

      const [rows] = searchTerms.length > 0 ? await pool.execute(
        `SELECT chamadoId AS chamado_id, chamadoNumber AS chamado_number,
                customerName AS customer_name, company, title, status, priority,
                createdAt AS created_at
         FROM megadesk_domain_chamados
         WHERE clientId = ? AND (customerId IS NULL OR customerId = '') AND (${placeholders})
         ORDER BY createdAt DESC LIMIT 50`,
        [tenantId, ...values]
      ) as any[] : [[]];

      const seen = new Set<string>();
      const linkedRows = [...(directRows as any[]), ...(rows as any[])].filter((row) => {
        if (seen.has(row.chamado_id)) return false;
        seen.add(row.chamado_id);
        return true;
      });

      return {
        chamados: linkedRows.map(r => ({
          id: r.chamado_id,
          number: r.chamado_number,
          customerName: r.customer_name,
          company: r.company,
          title: r.title,
          status: r.status,
          priority: r.priority,
          createdAt: r.created_at,
        })),
      };
    }),

  // Buscar conversas vinculadas ao cliente CRM pelo telefone/empresa
  getConversas: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const pool = getPool();
      const crmClient = crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));

      // Busca 1: por crm_client_id direto (vínculo criado ao abrir conversa via Atendimento Ativo)
      const [directRows] = await pool.execute(
        `SELECT conversation_id, customer_name, phone, company, status, last_message, time_label, created_at
         FROM megadesk_domain_conversations
         WHERE client_id = ? AND crm_client_id = ?
         ORDER BY created_at DESC LIMIT 50`,
        [tenantId, input.crmClientId]
      ) as any[];

      // Busca 2: por nome/empresa/telefone (fallback para conversas sem vínculo direto)
      const searchTerms: string[] = [];
      if (crmClient.phone) searchTerms.push(crmClient.phone.replace(/\D/g, ""));
      if (crmClient.whatsapp) searchTerms.push(crmClient.whatsapp.replace(/\D/g, ""));
      if (crmClient.companyName) searchTerms.push(crmClient.companyName);
      if (crmClient.responsibleName) searchTerms.push(crmClient.responsibleName);

      let indirectRows: any[] = [];
      if (searchTerms.length > 0) {
        const placeholders = searchTerms.map(() => "REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE ? OR company LIKE ? OR customer_name LIKE ?").join(" OR ");
        const values: string[] = [];
        searchTerms.forEach(term => {
          values.push(`%${term}%`, `%${term}%`, `%${term}%`);
        });
        const [rows] = await pool.execute(
          `SELECT conversation_id, customer_name, phone, company, status, last_message, time_label, created_at
           FROM megadesk_domain_conversations
           WHERE client_id = ? AND (crm_client_id IS NULL OR crm_client_id = '') AND (${placeholders})
           ORDER BY created_at DESC LIMIT 50`,
          [tenantId, ...values]
        ) as any[];
        indirectRows = rows as any[];
      }

      // Combinar e deduplicar por conversation_id
      const allRows = [...(directRows as any[]), ...indirectRows];
      const seen = new Set<string>();
      const uniqueRows = allRows.filter(r => {
        if (seen.has(r.conversation_id)) return false;
        seen.add(r.conversation_id);
        return true;
      });
      uniqueRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return {
        conversas: uniqueRows.slice(0, 50).map(r => ({
          id: r.conversation_id,
          customerName: r.customer_name,
          phone: r.phone,
          company: r.company,
          status: r.status,
          lastMessage: r.last_message,
          timeLabel: r.time_label,
          createdAt: r.created_at,
        })),
      };
    }),

  // Buscar timeline do cliente CRM
  getTimeline: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));
      const entries = await listCrmTimeline(input.crmClientId, tenantId);
      return { entries };
    }),

  // Adicionar entrada manual na timeline
  addTimelineEntry: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
      description: z.string().min(1),
      type: z.enum(["note", "call", "meeting", "email", "edit", "status_change", "other"]).optional().default("note"),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));
      await addCrmTimeline(input.crmClientId, tenantId, {
        type: input.type,
        description: input.description,
        author: ctx.userEmail,
      });
      return { success: true };
    }),

  // Importar clientes em massa via CSV (array de objetos já parseados)
  importCsv: megadeskProcedure
    .input(z.object({
      rows: z.array(z.object({
        customerType: z.string().optional().default(""),
        companyName: z.string().min(1),
        responsibleName: z.string().optional().default(""),
        cpfCnpj: z.string().optional().default(""),
        phone: z.string().optional().default(""),
        whatsapp: z.string().optional().default(""),
        email: z.string().optional().default(""),
        address: z.string().optional().default(""),
        city: z.string().optional().default(""),
        state: z.string().optional().default(""),
        cep: z.string().optional().default(""),
        status: z.string().optional().default("lead"),
        origin: z.string().optional().default("outro"),
        observations: z.string().optional().default(""),
      }).strict()).max(500, "Máximo de 500 registros por importação"),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      let imported = 0;
      let errors = 0;
      const errorMessages: string[] = [];

      for (const row of input.rows) {
        try {
          const customerType = parseCustomerType(row.customerType);
          const status = ["lead", "ativo", "inativo", "cancelado", "inadimplente"].includes(row.status ?? "")
            ? (row.status as any)
            : "lead";
          const origin = ["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"].includes(row.origin ?? "")
            ? (row.origin as any)
            : "outro";

          await createCrmClient(tenantId, {
            customerType,
            companyName: row.companyName,
            responsibleName: row.responsibleName ?? "",
            cpfCnpj: row.cpfCnpj ?? "",
            phone: row.phone ?? "",
            whatsapp: row.whatsapp ?? "",
            email: row.email ?? "",
            address: row.address ?? "",
            city: row.city ?? "",
            state: (row.state ?? "").slice(0, 2),
            cep: row.cep ?? "",
            status,
            origin,
            internalResponsible: "",
            tags: "",
            observations: row.observations ?? "",
          });
          imported++;
        } catch (err: unknown) {
          errors++;
          errorMessages.push(`Linha "${row.companyName}": ${err instanceof Error ? err.message : "Erro desconhecido"}`);
        }
      }

      return { imported, errors, errorMessages };
    }),
});
