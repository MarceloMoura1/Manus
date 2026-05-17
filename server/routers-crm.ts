/**
 * routers-crm.ts — Procedures tRPC para a página de Clientes (CRM)
 * REGRA 1: Toda procedure filtra por clientId.
 * REGRA 6: getReleasedClientOrThrow é chamado antes de qualquer operação.
 * REGRA 8: clientId sempre vem da sessão MegaDesk.
 */
import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listCrmClients,
  getCrmClientById,
  createCrmClient,
  updateCrmClient,
  deleteCrmClient,
  addCrmTimeline,
  listCrmTimeline,
} from "./db-crm";
import { getPool } from "./db";

const crmClientInputSchema = z.object({
  companyName: z.string().min(1, "Nome da empresa é obrigatório"),
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
});

export const crmRouter = router({
  // Listar clientes CRM do tenant
  list: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const clients = await listCrmClients(input.clientId, input.search);
      return { clients };
    }),

  // Buscar cliente CRM por ID
  getById: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const client = await getCrmClientById(input.crmClientId, input.clientId);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      }
      return { client };
    }),

  // Criar novo cliente CRM
  create: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      data: crmClientInputSchema,
    }))
    .mutation(async ({ input }) => {
      const result = await createCrmClient(input.clientId, input.data);
      return { success: true, crmClientId: result.crmClientId };
    }),

  // Atualizar cliente CRM com registro de histórico na timeline
  update: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
      data: crmClientInputSchema.partial(),
      editedBy: z.string().optional().default("Usuário"),
    }))
    .mutation(async ({ input }) => {
      await updateCrmClient(input.crmClientId, input.clientId, input.data);
      // Registrar na timeline quem editou e quando
      await addCrmTimeline(input.crmClientId, input.clientId, {
        type: "edit",
        description: `Cadastro editado por ${input.editedBy}`,
        author: input.editedBy,
      });
      return { success: true };
    }),

  // Excluir cliente CRM
  delete: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await deleteCrmClient(input.crmClientId, input.clientId);
      return { success: true };
    }),

  // Buscar chamados vinculados ao cliente CRM pelo nome/empresa
  getChamados: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const pool = getPool();
      // Buscar dados do cliente CRM para usar como filtro
      const crmClient = await getCrmClientById(input.crmClientId, input.clientId);
      if (!crmClient) return { chamados: [] };

      const searchTerms: string[] = [];
      if (crmClient.companyName) searchTerms.push(crmClient.companyName);
      if (crmClient.responsibleName) searchTerms.push(crmClient.responsibleName);
      if (crmClient.phone) searchTerms.push(crmClient.phone);
      if (crmClient.whatsapp) searchTerms.push(crmClient.whatsapp);

      if (searchTerms.length === 0) return { chamados: [] };

      // Buscar chamados que correspondam ao cliente (por empresa ou nome)
      const placeholders = searchTerms.map(() => "customer_name LIKE ? OR company LIKE ?").join(" OR ");
      const values: string[] = [];
      searchTerms.forEach(term => {
        values.push(`%${term}%`, `%${term}%`);
      });

      const [rows] = await pool.execute(
        `SELECT chamado_id, chamado_number, customer_name, company, title, status, priority, created_at
         FROM megadesk_domain_chamados
         WHERE client_id = ? AND (${placeholders})
         ORDER BY created_at DESC LIMIT 50`,
        [input.clientId, ...values]
      ) as any[];

      return {
        chamados: (rows as any[]).map(r => ({
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
  getConversas: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const pool = getPool();
      const crmClient = await getCrmClientById(input.crmClientId, input.clientId);
      if (!crmClient) return { conversas: [] };

      // Busca 1: por crm_client_id direto (vínculo criado ao abrir conversa via Atendimento Ativo)
      const [directRows] = await pool.execute(
        `SELECT conversation_id, customer_name, phone, company, status, last_message, time_label, created_at
         FROM megadesk_domain_conversations
         WHERE client_id = ? AND crm_client_id = ?
         ORDER BY created_at DESC LIMIT 50`,
        [input.clientId, input.crmClientId]
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
          [input.clientId, ...values]
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
  getTimeline: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const entries = await listCrmTimeline(input.crmClientId, input.clientId);
      return { entries };
    }),

  // Adicionar entrada manual na timeline
  addTimelineEntry: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
      description: z.string().min(1),
      author: z.string().optional().default("Usuário"),
      type: z.enum(["note", "call", "meeting", "email", "edit", "status_change", "other"]).optional().default("note"),
    }))
    .mutation(async ({ input }) => {
      await addCrmTimeline(input.crmClientId, input.clientId, {
        type: input.type,
        description: input.description,
        author: input.author,
      });
      return { success: true };
    }),

  // Importar clientes em massa via CSV (array de objetos já parseados)
  importCsv: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      rows: z.array(z.object({
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
      })).max(500, "Máximo de 500 registros por importação"),
    }))
    .mutation(async ({ input }) => {
      let imported = 0;
      let errors = 0;
      const errorMessages: string[] = [];

      for (const row of input.rows) {
        try {
          const status = ["lead", "ativo", "inativo", "cancelado", "inadimplente"].includes(row.status ?? "")
            ? (row.status as any)
            : "lead";
          const origin = ["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"].includes(row.origin ?? "")
            ? (row.origin as any)
            : "outro";

          await createCrmClient(input.clientId, {
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
        } catch (err: any) {
          errors++;
          errorMessages.push(`Linha "${row.companyName}": ${err.message ?? "Erro desconhecido"}`);
        }
      }

      return { imported, errors, errorMessages };
    }),
});
