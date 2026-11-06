import { tool } from "ai";
import { z } from "zod";
import { getPool } from "./db";
import {
  createPendingActionRequest,
  HERMES_TOOL_REGISTRY,
  type PendingActionRequest,
} from "./gemini-client";

export interface HermesToolContext {
  clientId: string;
  userId?: string;
  pool?: any;
  userPermissions?: readonly string[];
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export async function resolveClientInCRM(pool: any, clientId: string, termo: string) {
  const trimmed = termo.trim();
  const searchTerm = `%${trimmed}%`;
  const [rows] = (await pool.execute(
    `SELECT crm_client_id AS crmClientId, company_name AS companyName, responsible_name AS responsibleName, phone, status
       FROM megadesk_crm_clients
      WHERE client_id = ?
        AND status IN ('ativo', 'lead')
        AND (lifecycle_state IS NULL OR lifecycle_state <> 'archived')
        AND (
          crm_client_id = ?
          OR company_name LIKE ?
          OR responsible_name LIKE ?
          OR phone LIKE ?
        )
      ORDER BY company_name, crm_client_id LIMIT 10`,
    [clientId, trimmed, searchTerm, searchTerm, searchTerm],
  )) as any[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: "missing" as const };
  }

  const candidates = rows.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"));
  const normTerm = normalizeText(trimmed);
  const digits = trimmed.replace(/\D/g, "");

  const getDisplayName = (candidate: Record<string, unknown>): string => {
    const resp = typeof candidate.responsibleName === "string" ? candidate.responsibleName.trim() : "";
    const comp = typeof candidate.companyName === "string" ? candidate.companyName.trim() : "";
    if (resp && normalizeText(resp) === normTerm) return resp;
    if (comp && normalizeText(comp) === normTerm) return comp;
    return comp || resp || trimmed;
  };

  const exact = candidates.filter(
    (c) =>
      c.crmClientId === trimmed ||
      (typeof c.responsibleName === "string" && normalizeText(c.responsibleName) === normTerm) ||
      (typeof c.companyName === "string" && normalizeText(c.companyName) === normTerm) ||
      (digits.length >= 8 && typeof c.phone === "string" && c.phone.replace(/\D/g, "") === digits),
  );

  const selected = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
  if (selected) {
    return {
      status: "found" as const,
      customerName: getDisplayName(selected),
      data: selected,
    };
  }

  const options = Array.from(new Set(candidates.map(getDisplayName).filter(Boolean))).slice(0, 5);
  return { status: "ambiguous" as const, options };
}

export const solicitarAberturaChamadoParameters = z.object({
  termoCliente: z.string().describe("Nome da pessoa física, empresa, razão social ou telefone do cliente"),
  assunto: z.string().describe("Problema relatado, resumo ou motivo do chamado"),
  descricaoDetalhada: z.string().optional().describe("Detalhes técnicos adicionais se informados pelo usuário"),
  prioridade: z.enum(["baixa", "media", "alta", "urgente"]).default("media"),
});

export const consultarCrmParameters = z.object({
  busca: z.string().describe("Nome, empresa, documento ou telefone para buscar"),
});

export function createHermesTools(context: HermesToolContext) {
  let pool = context.pool;
  if (!pool) {
    try {
      pool = getPool();
    } catch {}
  }

  const permissions = context.userPermissions ?? [];
  const canTickets = permissions.length === 0 || permissions.some((p) => p === "tickets" || p === "support");
  const canCrm = permissions.length === 0 || permissions.some((p) => p === "crm" || p === "sales");

  const tools: Record<string, any> = {};

  if (canTickets) {
    const ticketToolDef = tool({
      description:
        "Disparado quando o usuário solicita a abertura ou preparação de um chamado/suporte/ticket para um cliente ou lead.",
      inputSchema: solicitarAberturaChamadoParameters,
      execute: async ({
        termoCliente,
        assunto,
        descricaoDetalhada,
        prioridade,
      }) => {
        if (!pool) {
          return {
            success: false,
            status: "erro_banco",
            message: "Não consegui consultar o cadastro do cliente no momento. Tente novamente em instantes.",
          };
        }

        const resolution = await resolveClientInCRM(pool, context.clientId, termoCliente);

        if (resolution.status === "missing") {
          return {
            success: false,
            status: "cliente_nao_encontrado",
            termoCliente,
            message: `Não encontrei nenhum cliente ou lead chamado '${termoCliente}' no CRM. Deseja cadastrá-lo?`,
          };
        }

        if (resolution.status === "ambiguous") {
          return {
            success: false,
            status: "cliente_ambiguo",
            opcoes: resolution.options,
            message: `Localizei mais de um cliente com esse nome: ${resolution.options.map((o) => `[${o}]`).join(" e ")}. Para qual deles deseja abrir o chamado?`,
          };
        }

        const resolvedCustomer = resolution.customerName;
        const priorityMap = { baixa: "low", media: "medium", alta: "high", urgente: "urgent" } as const;
        const mappedPriority = priorityMap[prioridade] ?? "medium";
        const finalDescription = descricaoDetalhada?.trim() || assunto.trim();

        const ticketTool = HERMES_TOOL_REGISTRY.find((t) => t.name === "create_ticket");
        let pendingActionRequest: PendingActionRequest | undefined;
        if (ticketTool) {
          pendingActionRequest = createPendingActionRequest(
            ticketTool,
            {
              customer: resolvedCustomer,
              title: assunto.trim(),
              description: finalDescription,
              priority: mappedPriority,
            },
            { clientId: context.clientId, userId: context.userId || "operator" },
          );
        }

        return {
          success: true,
          status: "preparado",
          cliente: resolvedCustomer,
          assunto: assunto.trim(),
          descricao: finalDescription,
          prioridade: mappedPriority,
          pendingActionRequest,
          message: `Preparei o chamado "${assunto.trim()}" para ${resolvedCustomer}. Confirme o card para executar a abertura.`,
        };
      },
    });
    (ticketToolDef as any).parameters = solicitarAberturaChamadoParameters;
    tools.solicitar_abertura_chamado = ticketToolDef;
  }

  if (canCrm) {
    const crmToolDef = tool({
      description: "Busca informações detalhadas de clientes, leads ou propostas no CRM.",
      inputSchema: consultarCrmParameters,
      execute: async ({ busca }) => {
        if (!pool) {
          return { success: false, error: "Banco de dados indisponível no momento." };
        }
        const trimmed = busca.trim();
        const searchTerm = `%${trimmed}%`;
        const [rows] = (await pool.execute(
          `SELECT crm_client_id AS crmClientId, company_name AS companyName, responsible_name AS responsibleName, phone, status, cpf_cnpj AS document, email
             FROM megadesk_crm_clients
            WHERE client_id = ?
              AND status IN ('ativo', 'lead')
              AND (lifecycle_state IS NULL OR lifecycle_state <> 'archived')
              AND (
                crm_client_id = ?
                OR company_name LIKE ?
                OR responsible_name LIKE ?
                OR phone LIKE ?
                OR cpf_cnpj LIKE ?
              )
            ORDER BY company_name, crm_client_id LIMIT 10`,
          [context.clientId, trimmed, searchTerm, searchTerm, searchTerm, searchTerm],
        )) as any[];

        if (!Array.isArray(rows) || rows.length === 0) {
          return {
            success: true,
            total: 0,
            resultados: [],
            message: `Nenhum cliente ou lead encontrado no CRM para '${busca}'.`,
          };
        }

        return {
          success: true,
          total: rows.length,
          resultados: rows.map((r) => ({
            id: r.crmClientId,
            nomeEmpresa: r.companyName,
            responsavel: r.responsibleName,
            telefone: r.phone,
            documento: r.document,
            email: r.email,
            status: r.status,
          })),
        };
      },
    });
    (crmToolDef as any).parameters = consultarCrmParameters;
    tools.consultar_crm = crmToolDef;
  }

  return tools;
}

