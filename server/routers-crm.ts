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
  findDuplicateCrmClient,
  addCrmTimeline,
  listCrmTimeline,
} from "./db-crm";
import { getPool } from "./db";
import { CUSTOMER_TYPES, parseCustomerType, customerTypeToCsv } from "../shared/crm";
import { isValidCpf, isValidCnpj } from "../shared/br-documents";
import { normalizeContactPhone } from "../shared/contact-phone";

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
  companyName: z.string().trim().min(1, "Nome do cliente é obrigatório").max(255),
  responsibleName: z.string().max(180).optional().default(""),
  cpfCnpj: z.string().max(20).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  whatsapp: z.string().max(40).optional().default(""),
  email: z.union([z.literal(""), z.string().email("E-mail inválido.").max(255)]).optional().default(""),
  address: z.string().max(255).optional().default(""),
  city: z.string().max(120).optional().default(""),
  state: z.string().max(2).optional().default(""),
  cep: z.string().max(10).optional().default(""),
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
  if (data.cpfCnpj) {
    const valid = data.customerType === "person" ? isValidCpf(data.cpfCnpj) : isValidCnpj(data.cpfCnpj);
    if (!valid) throw new TRPCError({ code: "BAD_REQUEST", message: data.customerType === "person" ? "CPF inválido." : "CNPJ inválido." });
  }
  for (const [label, value] of [["Telefone", data.phone], ["WhatsApp", data.whatsapp]] as const) {
    if (normalizeContactPhone(value).status === "invalid") throw new TRPCError({ code: "BAD_REQUEST", message: `${label} inválido.` });
  }
  return data;
}

function safeCrmWriteError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const wrapped = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const dbError = wrapped.cause?.code ? wrapped.cause : wrapped;
  if (dbError.code === "ER_DUP_ENTRY") {
    const message = dbError.message ?? "";
    if (message.includes("tenant_document")) throw new TRPCError({ code: "CONFLICT", message: "Documento já cadastrado." });
    if (message.includes("tenant_phone")) throw new TRPCError({ code: "CONFLICT", message: "Telefone já cadastrado." });
    if (message.includes("tenant_email")) throw new TRPCError({ code: "CONFLICT", message: "E-mail já cadastrado." });
    throw new TRPCError({ code: "CONFLICT", message: "Cliente duplicado." });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível salvar o cliente. Tente novamente." });
}

export const crmRouter = router({
  findDuplicate: megadeskProcedure
    .input(z.object({ cpfCnpj: z.string().max(20).optional().default(""), phone: z.string().max(40).optional().default("") }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const duplicate = await findDuplicateCrmClient(tenantId, input);
      return duplicate ? {
        crmClientId: duplicate.crmClientId,
        companyName: duplicate.companyName,
        matchedField: input.cpfCnpj && duplicate.cpfCnpj === input.cpfCnpj.replace(/\D/g, "") ? "cpfCnpj" as const : "phone" as const,
      } : null;
    }),
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
      try {
        const result = await createCrmClient(tenantId, validateCustomerDocument(input.data));
        return { success: true, crmClientId: result.crmClientId };
      } catch (error) { safeCrmWriteError(error); }
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
      try {
        await updateCrmClient(input.crmClientId, tenantId, input.data);
        // Registrar na timeline quem editou e quando
        await addCrmTimeline(input.crmClientId, tenantId, {
          type: "edit",
          description: `Cadastro editado por ${ctx.userEmail}`,
          author: ctx.userEmail,
        });
        return { success: true };
      } catch (error) { safeCrmWriteError(error); }
    }),

  // Buscar chamados vinculados ao cliente CRM pelo nome/empresa
  getChamados: megadeskProcedure
    .input(z.object({
      crmClientId: z.string().min(1),
    }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmAccess(ctx);
      const pool = getPool();
      crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));

      const [directRows] = await pool.execute(
        `SELECT chamadoId AS chamado_id, chamadoNumber AS chamado_number,
                customerName AS customer_name, company, title, status, priority,
                createdAt AS created_at
         FROM megadesk_domain_chamados
         WHERE clientId = ? AND customerId = ?
         ORDER BY createdAt DESC LIMIT 50`,
        [tenantId, input.crmClientId]
      ) as any[];

      return {
        chamados: (directRows as any[]).map(r => ({
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
      crmClientOrNotFound(await getCrmClientById(input.crmClientId, tenantId));
      const [directRows] = await pool.execute(
        `SELECT c.conversation_id, c.customer_name, c.phone, c.company, c.status, c.last_message, c.time_label, c.created_at
         FROM megadesk_domain_conversations c
         JOIN megadesk_conversation_contacts contact
           ON contact.client_id = c.client_id AND contact.contact_id = c.contact_id
         WHERE c.client_id = ? AND contact.crm_client_id = ?
         ORDER BY c.created_at DESC LIMIT 50`,
        [tenantId, input.crmClientId]
      ) as any[];

      return {
        conversas: (directRows as any[]).map(r => ({
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
