import { tool } from "ai";
import { z } from "zod";
import { getPool } from "./db";
import {
  createPendingActionRequest,
  HERMES_TOOL_REGISTRY,
  type PendingActionRequest,
} from "./gemini-client";
import { executeHermesTicketAction } from "./hermes-ticket-actions";
import { executeSendWhatsAppMessage } from "./hermes-crm-actions";
import { normalizeContactPhone } from "../shared/contact-phone";
import { getAiTokenUsageSummary } from "./modules/ai-usage/ai-usage.service";

export interface HermesToolContext {
  clientId: string;
  userId?: string;
  userEmail?: string;
  operationalUserId?: string;
  userRole?: string;
  pool?: any;
  userPermissions?: readonly string[];
  hitlRequired?: boolean;
  executeTicketAction?: typeof executeHermesTicketAction;
  executeWhatsAppAction?: typeof executeSendWhatsAppMessage;
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

export const sendWhatsappMessageParameters = z.object({
  recipient: z.string().describe("Nome do cliente/contato no CRM ou número de telefone direto"),
  phone: z.string().optional().describe("Número formatado se já identificado"),
  message: z.string().describe("O conteúdo da mensagem de texto a ser enviada"),
});

export const consultarCrmParameters = z.object({
  busca: z.string().describe("Nome, empresa, documento ou telefone para buscar"),
});

export const consultarVendasParameters = z.object({
  mes: z.number().min(1).max(12).optional().describe("Mês numérico de 1 a 12 (ex: 10 para outubro)"),
  ano: z.number().min(2020).max(2035).optional().describe("Ano de referência (ex: 2026)"),
  periodo: z.enum(["hoje", "esta_semana", "este_mes", "mes_passado", "total"]).optional().describe("Período pré-definido"),
});

export const consultarChamadosParameters = z.object({
  status: z.enum(["open", "in_progress", "waiting", "closed", "all"]).optional().describe("Filtrar por status dos chamados (ex: open para abertos)"),
  search: z.string().optional().describe("Termo de busca textual em títulos, clientes ou código"),
  limit: z.number().min(1).max(50).optional().describe("Limite de chamados a retornar"),
});

export const getSystemMetricsSummaryParameters = z.object({
  categoria: z
    .enum(["todas", "atendimento", "chamados", "crm", "ia_tokens"])
    .optional()
    .describe("Foco opcional da consulta: 'todas', 'atendimento', 'chamados', 'crm', 'ia_tokens'. Padrão: 'todas'."),
  periodo: z
    .enum(["today", "7d", "30d", "month"])
    .optional()
    .describe("Filtro de período unificado: 'today' (hoje), '7d' (últimos 7 dias), '30d' (últimos 30 dias), 'month' (este mês). Padrão: 'today'."),
});

export const createDailyActionTaskParameters = z.object({
  title: z.string().describe("Descrição objetiva da ação operacional recomendada"),
  priority: z.enum(["alta", "media", "baixa"]).default("media").describe("Nível de prioridade da tarefa ('alta', 'media' ou 'baixa')"),
  targetRoute: z
    .enum(["conversations", "tickets", "crm-proposals", "tracking", "home"])
    .default("home")
    .describe("Rota ou módulo do sistema para executar a ação ('conversations', 'tickets', 'crm-proposals', 'tracking' ou 'home')"),
});

export function calculateDateRange(mes?: number, ano?: number, periodo?: string) {
  const agora = new Date();
  const anoCorrente = agora.getFullYear();
  const mesCorrente = agora.getMonth() + 1;
  const anoAlvo = ano ?? anoCorrente;

  const mesesNomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];

  let inicioStr: string;
  let fimStr: string;
  let periodoLabel: string;

  if (mes !== undefined) {
    const mesNum = Math.min(Math.max(mes, 1), 12);
    const mesFormatado = String(mesNum).padStart(2, "0");
    const ultimoDia = new Date(anoAlvo, mesNum, 0).getDate();
    const diaFormatado = String(ultimoDia).padStart(2, "0");
    inicioStr = `${anoAlvo}-${mesFormatado}-01 00:00:00`;
    fimStr = `${anoAlvo}-${mesFormatado}-${diaFormatado} 23:59:59`;
    periodoLabel = `${mesesNomes[mesNum - 1]}/${anoAlvo}`;
  } else if (periodo === "hoje") {
    const dia = String(agora.getDate()).padStart(2, "0");
    const m = String(mesCorrente).padStart(2, "0");
    inicioStr = `${anoCorrente}-${m}-${dia} 00:00:00`;
    fimStr = `${anoCorrente}-${m}-${dia} 23:59:59`;
    periodoLabel = "hoje";
  } else if (periodo === "esta_semana") {
    const diaSemana = agora.getDay();
    const domingo = new Date(agora);
    domingo.setDate(agora.getDate() - diaSemana);
    const anoD = domingo.getFullYear();
    const mesD = String(domingo.getMonth() + 1).padStart(2, "0");
    const diaD = String(domingo.getDate()).padStart(2, "0");
    inicioStr = `${anoD}-${mesD}-${diaD} 00:00:00`;
    const hojeAno = agora.getFullYear();
    const hojeMes = String(mesCorrente).padStart(2, "0");
    const hojeDia = String(agora.getDate()).padStart(2, "0");
    fimStr = `${hojeAno}-${hojeMes}-${hojeDia} 23:59:59`;
    periodoLabel = "esta semana";
  } else if (periodo === "mes_passado") {
    const anoPassado = mesCorrente === 1 ? anoCorrente - 1 : anoCorrente;
    const mesPassado = mesCorrente === 1 ? 12 : mesCorrente - 1;
    const mesFormatado = String(mesPassado).padStart(2, "0");
    const ultimoDia = new Date(anoPassado, mesPassado, 0).getDate();
    const diaFormatado = String(ultimoDia).padStart(2, "0");
    inicioStr = `${anoPassado}-${mesFormatado}-01 00:00:00`;
    fimStr = `${anoPassado}-${mesFormatado}-${diaFormatado} 23:59:59`;
    periodoLabel = `${mesesNomes[mesPassado - 1]}/${anoPassado}`;
  } else if (periodo === "total") {
    inicioStr = "2020-01-01 00:00:00";
    fimStr = "2035-12-31 23:59:59";
    periodoLabel = "total histórico";
  } else {
    // Default: este_mes
    const mesFormatado = String(mesCorrente).padStart(2, "0");
    const ultimoDia = new Date(anoCorrente, mesCorrente, 0).getDate();
    const diaFormatado = String(ultimoDia).padStart(2, "0");
    inicioStr = `${anoCorrente}-${mesFormatado}-01 00:00:00`;
    fimStr = `${anoCorrente}-${mesFormatado}-${diaFormatado} 23:59:59`;
    periodoLabel = `${mesesNomes[mesCorrente - 1]}/${anoCorrente}`;
  }

  return { inicioStr, fimStr, periodoLabel };
}

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
  const canSales = permissions.length === 0 || permissions.some((p) => p === "sales" || p === "erp" || p === "erp-sales");
  const canWhatsApp = permissions.length === 0 || permissions.some((p) => p === "conversations" || p === "whatsapp" || p === "crm" || p === "sales");

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

        // Se HITL não for obrigatório, executa a mutação diretamente e NUNCA retorna pendingActionRequest
        if (context.hitlRequired === false) {
          try {
            const actorUserId = context.operationalUserId || context.userEmail || context.userId || "operator";
            const ticketExecutor = context.executeTicketAction ?? executeHermesTicketAction;
            const directResult = await ticketExecutor({
              clientId: context.clientId,
              actorUserId,
              action: {
                actionType: "CREATE_TICKET",
                args: {
                  customer: resolvedCustomer,
                  title: assunto.trim(),
                  description: finalDescription,
                  priority: mappedPriority,
                },
              },
              resolveAssignee: async () => null,
            });

            return {
              success: true,
              status: "executado_direto",
              ticketNumber: String(directResult?.entityId ?? ""),
              cliente: resolvedCustomer,
              assunto: assunto.trim(),
              descricao: finalDescription,
              prioridade: mappedPriority,
              message: "Chamado criado com sucesso no banco de dados.",
            };
          } catch (err: any) {
            console.error("[HermesTools] Erro ao executar criação direta de chamado:", err);
            return {
              success: false,
              status: "erro_execucao",
              message: `Não foi possível criar o chamado diretamente: ${err?.message || "Erro desconhecido"}.`,
            };
          }
        }

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
            {
              clientId: context.clientId,
              userId: context.userEmail || context.userId || context.operationalUserId || "operator",
              userEmail: context.userEmail,
              operationalUserId: context.operationalUserId,
            },
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

    const chamadosToolDef = tool({
      description: "Retorna a relação de chamados abertos ou métricas gerais de tickets no sistema.",
      inputSchema: consultarChamadosParameters,
      execute: async ({ status, search, limit }) => {
        if (!pool) {
          return {
            success: false,
            error: "Banco de dados indisponível no momento.",
          };
        }

        const where = ["clientId = ?"];
        const values: unknown[] = [context.clientId];

        if (status && status !== "all") {
          const statusMap: Record<string, string> = { resolved: "closed", pending: "waiting" };
          const norm = statusMap[status] ?? status;
          where.push("status = ?");
          values.push(norm);
        }

        if (search) {
          where.push("(title LIKE ? OR customerName LIKE ? OR company LIKE ? OR CAST(chamadoNumber AS CHAR) LIKE ? OR LPAD(CAST(chamadoNumber AS CHAR), 4, '0') LIKE ?)");
          const q = `%${search.trim()}%`;
          values.push(q, q, q, q, q);
        }

        let totalCount = 0;
        let openCount = 0;
        let inProgressCount = 0;
        let waitingCount = 0;

        try {
          const [totalsRows] = (await pool.execute(
            `SELECT COUNT(*) AS total,
                    SUM(status = 'open') AS open,
                    SUM(status = 'in_progress') AS in_progress,
                    SUM(status = 'waiting') AS waiting,
                    SUM(status = 'closed') AS closed
               FROM megadesk_domain_chamados WHERE ${where.join(" AND ")}`,
            values,
          )) as any[];
          if (totalsRows && totalsRows[0]) {
            totalCount = Number(totalsRows[0].total ?? 0);
            openCount = Number(totalsRows[0].open ?? 0);
            inProgressCount = Number(totalsRows[0].in_progress ?? 0);
            waitingCount = Number(totalsRows[0].waiting ?? 0);
          }
        } catch {}

        const safeLimit = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 50);
        const [rows] = (await pool.execute(
          `SELECT chamadoId AS id, chamadoNumber AS numero, title AS assunto, customerName AS cliente, company,
                  status, priority AS prioridade, createdAt, updatedAt
             FROM megadesk_domain_chamados
            WHERE ${where.join(" AND ")}
            ORDER BY updatedAt DESC, chamadoNumber DESC LIMIT ?`,
          [...values, safeLimit],
        )) as any[];

        const todosChamados = (Array.isArray(rows) ? rows : []).map(c => ({
          id: c.id,
          codigo: `#${String(c.numero || c.id).padStart(4, "0")}`,
          assunto: c.assunto || "Sem assunto",
          cliente: c.cliente || c.company || "Não informado",
          status: c.status,
          prioridade: c.prioridade || "normal",
        }));

        const chamadosAbertos = (!status || status === "all")
          ? todosChamados.filter(c => !["closed", "fechado", "resolvido", "resolved", "cancelado", "cancelled"].includes(String(c.status).toLowerCase()))
          : todosChamados;

        const totalAbertos = Math.max(chamadosAbertos.length, openCount);
        const totalFinal = Math.max(todosChamados.length, totalCount);

        return {
          success: true,
          totalAbertos,
          total: totalFinal,
          open: totalAbertos,
          inProgress: inProgressCount,
          pending: waitingCount,
          chamados: chamadosAbertos.map(c => ({
            id: c.id,
            codigo: c.codigo,
            assunto: c.assunto,
            cliente: c.cliente,
            status: c.status,
            prioridade: c.prioridade,
          })),
          tickets: chamadosAbertos.map(c => ({
            id: c.id,
            ticketNumber: c.id,
            title: c.assunto,
            customer: c.cliente,
            status: c.status,
            priority: c.prioridade,
          })),
        };
      },
    });
    (chamadosToolDef as any).parameters = consultarChamadosParameters;
    tools.consultar_chamados = chamadosToolDef;
    tools.get_tickets_overview = chamadosToolDef;
  }

  if (canSales) {
    const vendasToolDef = tool({
      description: "Consulta o faturamento, volume de vendas e pedidos recentes filtrando por mês, ano ou período temporal.",
      inputSchema: consultarVendasParameters,
      execute: async ({ mes, ano, periodo }) => {
        if (!pool) {
          return {
            success: false,
            error: "Banco de dados indisponível no momento.",
          };
        }

        const { inicioStr, fimStr, periodoLabel } = calculateDateRange(mes, ano, periodo);

        let total = 0;
        let faturamentoTotal = "R$ 0,00";
        let ticketMedioFormatado = "R$ 0,00";
        let listaResumida: Array<{ numero: string; cliente: string; valor: string; data?: string }> = [];

        try {
          const [aggRows] = (await pool.execute(
            `SELECT COUNT(*) AS total, COALESCE(SUM(total_cents), 0) AS totalCents
               FROM erp_sale_orders
              WHERE client_id = ?
                AND (document_type = 'sale' OR document_type IS NULL)
                AND (status <> 'cancelled' OR status IS NULL)
                AND (created_at >= ? AND created_at <= ?)`,
            [context.clientId, inicioStr, fimStr],
          )) as any[];

          if (aggRows && aggRows[0]) {
            total = Number(aggRows[0].total ?? 0);
            const cents = Number(aggRows[0].totalCents ?? 0);
            faturamentoTotal = (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const avgCents = total > 0 ? cents / total : 0;
            ticketMedioFormatado = (avgCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          }

          const [recentRows] = (await pool.execute(
            `SELECT id, order_number AS orderNumber, customer_name_snapshot AS customerName,
                    total_cents AS totalCents, created_at AS createdAt
               FROM erp_sale_orders
              WHERE client_id = ?
                AND (document_type = 'sale' OR document_type IS NULL)
                AND (status <> 'cancelled' OR status IS NULL)
                AND (created_at >= ? AND created_at <= ?)
              ORDER BY created_at DESC
              LIMIT 5`,
            [context.clientId, inicioStr, fimStr],
          )) as any[];

          if (Array.isArray(recentRows)) {
            listaResumida = recentRows.map(r => ({
              numero: String(r.orderNumber || `#${r.id}`),
              cliente: String(r.customerName || "Cliente"),
              valor: (Number(r.totalCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
              data: r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR") : undefined,
            }));
          }
        } catch {
          try {
            const [opRows] = (await pool.execute(
              `SELECT COUNT(*) as total, SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.value')) AS DECIMAL(10,2))) as total_value
                 FROM megadesk_domain_operational_records 
                WHERE client_id = ? AND record_type = 'sale'
                  AND created_at >= ? AND created_at <= ?`,
              [context.clientId, inicioStr, fimStr],
            )) as any[];
            if (opRows && opRows[0]) {
              total = Number(opRows[0].total ?? 0);
              const val = Number(opRows[0].total_value ?? 0);
              faturamentoTotal = val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
              ticketMedioFormatado = (total > 0 ? val / total : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            }
          } catch {}
        }

        return {
          success: true,
          periodoConsultado: periodoLabel,
          quantidadePedidos: total,
          faturamentoTotal,
          ticketMedio: ticketMedioFormatado,
          pedidosRecentes: listaResumida,
        };
      },
    });
    (vendasToolDef as any).parameters = consultarVendasParameters;
    tools.consultar_vendas = vendasToolDef;
    tools.get_sales_overview = vendasToolDef;
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

  if (canWhatsApp) {
    const whatsappToolDef = tool({
      description: "Envia mensagem de texto via WhatsApp para um cliente ou contato.",
      inputSchema: sendWhatsappMessageParameters,
      execute: async ({ recipient, phone, message }) => {
        const cleanRecipient = recipient.trim();
        const cleanMessage = message.trim();
        if (!cleanMessage) {
          return {
            success: false,
            message: "A mensagem não pode ser vazia.",
          };
        }

        let resolvedPhone: string | null = null;
        let displayName = cleanRecipient;

        // 1. Se passou telefone explícito, tenta normalizar
        if (phone && phone.trim()) {
          const directNorm = normalizeContactPhone(phone.trim());
          if (directNorm.status === "valid" && directNorm.value) {
            resolvedPhone = directNorm.value;
          }
        }

        // 2. Se não achou telefone, busca no CRM
        if (!resolvedPhone && pool) {
          try {
            const resolution = await resolveClientInCRM(pool, context.clientId, cleanRecipient);
            if (resolution.status === "found" && resolution.data) {
              displayName = resolution.customerName || cleanRecipient;
              const crmCandidate = String((resolution.data as any).phone || (resolution.data as any).whatsapp || "");
              const crmNorm = normalizeContactPhone(crmCandidate);
              if (crmNorm.status === "valid" && crmNorm.value) {
                resolvedPhone = crmNorm.value;
              }
            } else if (resolution.status === "ambiguous") {
              return {
                success: false,
                status: "cliente_ambiguo",
                opcoes: resolution.options,
                message: `Localizei mais de um contato com esse nome: ${resolution.options.map((o) => `[${o}]`).join(" e ")}. Para qual deles deseja enviar a mensagem?`,
              };
            }
          } catch {}
        }

        // 3. Se ainda não achou, tenta normalizar o próprio recipient como telefone direto
        if (!resolvedPhone) {
          const recNorm = normalizeContactPhone(cleanRecipient);
          if (recNorm.status === "valid" && recNorm.value) {
            resolvedPhone = recNorm.value;
          }
        }

        // Se ainda não temos um telefone válido
        if (!resolvedPhone) {
          return {
            success: false,
            status: "telefone_invalido",
            message: "Contato não possui número de telefone válido registrado.",
          };
        }

        const whatsappTool = HERMES_TOOL_REGISTRY.find((t) => t.name === "send_whatsapp_message");

        // Se HITL não for obrigatório, executa diretamente
        if (context.hitlRequired === false) {
          try {
            const actorUserId = context.operationalUserId || context.userEmail || context.userId || "operator";
            const actorName = context.userEmail || "Assistente IA";
            const whatsappExecutor = context.executeWhatsAppAction ?? executeSendWhatsAppMessage;
            await whatsappExecutor({
              tenantId: context.clientId,
              recipient: displayName,
              phone: resolvedPhone,
              message: cleanMessage,
              senderUserId: actorUserId,
              senderName: actorName,
            });

            return {
              success: true,
              status: "executado_direto",
              recipient: displayName,
              phone: resolvedPhone,
              message: "Mensagem enviada com sucesso pelo WhatsApp.",
            };
          } catch (err: any) {
            console.error("[HermesTools] Erro ao executar envio direto de WhatsApp:", err);
            return {
              success: false,
              status: "erro_execucao",
              message: `Não foi possível enviar a mensagem pelo WhatsApp: ${err?.message || "Erro desconhecido"}.`,
            };
          }
        }

        // HITL obrigatório: gera PendingActionRequest
        let pendingActionRequest: PendingActionRequest | undefined;
        if (whatsappTool) {
          pendingActionRequest = createPendingActionRequest(
            whatsappTool,
            {
              recipient: displayName,
              clientName: displayName,
              phone: resolvedPhone,
              message: cleanMessage,
              messageContent: cleanMessage,
            },
            {
              clientId: context.clientId,
              userId: context.userEmail || context.userId || context.operationalUserId || "operator",
              userEmail: context.userEmail,
              operationalUserId: context.operationalUserId,
            },
          );
        }

        return {
          success: true,
          status: "preparado",
          recipient: displayName,
          phone: resolvedPhone,
          message: `Preparei a mensagem para ${displayName}. Confirme o card para disparar.`,
          pendingActionRequest,
        };
      },
    });
    (whatsappToolDef as any).parameters = sendWhatsappMessageParameters;
    tools.send_whatsapp_message = whatsappToolDef;
  }

  // ─── FERRAMENTA DE RESUMO OPERACIONAL E MÉTRICAS DO SISTEMA ─────────────────
  const metricsToolDef = tool({
    description:
      "Consulta em tempo real o resumo operacional da empresa (conversas ativas e carga por atendente, chamados abertos/críticos, rastreamentos ativos, leads/orçamentos recentes e status da cota de tokens de IA) para auxiliar o usuário nas prioridades e tarefas do dia.",
    inputSchema: getSystemMetricsSummaryParameters,
    execute: async ({ categoria = "todas", periodo = "today" }) => {
      if (!pool) {
        return {
          success: false,
          message: "Banco de dados indisponível no momento para consolidar os indicadores.",
        };
      }

      const tenantId = context.clientId;
      const result: Record<string, any> = {
        success: true,
        tenantId,
        periodo,
        dataHora: new Date().toISOString(),
      };

      // 1. Atendimento (Conversas WhatsApp)
      if (categoria === "todas" || categoria === "atendimento") {
        try {
          const [convSummary] = (await pool.execute(
            `SELECT
               COUNT(*) AS totalAbertas,
               SUM(CASE WHEN status = 'bot' THEN 1 ELSE 0 END) AS emTriagemBot,
               SUM(CASE WHEN status <> 'bot' AND (assigned_user_id IS NOT NULL OR assigned_user_name IS NOT NULL) THEN 1 ELSE 0 END) AS emAtendimentoHumano,
               SUM(CASE WHEN status <> 'bot' AND assigned_user_id IS NULL AND assigned_user_name IS NULL THEN 1 ELSE 0 END) AS filaEspera
             FROM megadesk_domain_conversations
            WHERE client_id = ? AND status <> 'closed'`,
            [tenantId]
          )) as any[];

          const [operatorLoad] = (await pool.execute(
            `SELECT
               COALESCE(assigned_user_name, assigned_user_id, 'Sem atendente') AS operador,
               COUNT(*) AS conversasAtivas
             FROM megadesk_domain_conversations
            WHERE client_id = ? AND status <> 'closed' AND (assigned_user_id IS NOT NULL OR assigned_user_name IS NOT NULL)
            GROUP BY operador
            ORDER BY conversasAtivas DESC
            LIMIT 5`,
            [tenantId]
          )) as any[];

          result.atendimento = {
            totalAbertas: Number(convSummary?.[0]?.totalAbertas || 0),
            emTriagemBot: Number(convSummary?.[0]?.emTriagemBot || 0),
            emAtendimentoHumano: Number(convSummary?.[0]?.emAtendimentoHumano || 0),
            filaEspera: Number(convSummary?.[0]?.filaEspera || 0),
            cargaPorAtendente: (operatorLoad || []).map((op: any) => ({
              operador: String(op.operador),
              conversas: Number(op.conversasAtivas || 0),
            })),
          };
        } catch {
          result.atendimento = { totalAbertas: 0, filaEspera: 0 };
        }
      }

      // 2. Chamados (Tickets)
      if (categoria === "todas" || categoria === "chamados") {
        try {
          const [ticketsSummary] = (await pool.execute(
            `SELECT
               COUNT(*) AS totalAtivos,
               SUM(CASE WHEN LOWER(priority) IN ('critica', 'crítica', 'urgent', 'urgente', 'alta', 'high') THEN 1 ELSE 0 END) AS criticos,
               SUM(CASE WHEN LOWER(status) IN ('open', 'aberto') THEN 1 ELSE 0 END) AS novosAbertos,
               SUM(CASE WHEN LOWER(status) IN ('in_progress', 'em_andamento', 'andamento') THEN 1 ELSE 0 END) AS emAndamento,
               SUM(CASE WHEN LOWER(status) IN ('waiting', 'aguardando') THEN 1 ELSE 0 END) AS aguardando
             FROM megadesk_domain_chamados
            WHERE clientId = ? AND LOWER(status) NOT IN ('closed', 'fechado', 'resolvido', 'concluido', 'concluído')`,
            [tenantId]
          )) as any[];

          result.chamados = {
            totalAtivos: Number(ticketsSummary?.[0]?.totalAtivos || 0),
            criticosUrgentes: Number(ticketsSummary?.[0]?.criticos || 0),
            novosAbertos: Number(ticketsSummary?.[0]?.novosAbertos || 0),
            emAndamento: Number(ticketsSummary?.[0]?.emAndamento || 0),
            aguardandoCliente: Number(ticketsSummary?.[0]?.aguardando || 0),
          };
        } catch {
          result.chamados = { totalAtivos: 0, criticosUrgentes: 0 };
        }
      }

      // 3. Rastreamentos Operacionais
      if (categoria === "todas") {
        try {
          const [trackingRows] = (await pool.execute(
            `SELECT COUNT(*) AS total
             FROM megadesk_domain_operational_records
            WHERE client_id = ?
              AND record_type = 'tracking'
              AND (status IS NULL OR LOWER(status) NOT IN ('delivered', 'entregue', 'closed', 'fechado', 'finalizado', 'concluido', 'concluído'))`,
            [tenantId]
          )) as any[];
          result.rastreamentos = {
            ativos: Number(trackingRows?.[0]?.total || 0),
          };
        } catch {
          result.rastreamentos = { ativos: 0 };
        }
      }

      // 4. CRM & Vendas (Leads & Oportunidades/Orçamentos)
      if (categoria === "todas" || categoria === "crm") {
        try {
          const [leadsRows] = (await pool.execute(
            `SELECT COUNT(*) AS totalLeads
             FROM megadesk_crm_clients
            WHERE client_id = ? AND status = 'lead' AND (lifecycle_state IS NULL OR lifecycle_state <> 'archived')`,
            [tenantId]
          )) as any[];

          const [oppsRows] = (await pool.execute(
            `SELECT COUNT(*) AS totalOportunidades, COALESCE(SUM(estimated_value), 0) AS valorTotal
             FROM megadesk_crm_opportunities
            WHERE client_id = ? AND status = 'open'`,
            [tenantId]
          )) as any[];

          result.crm = {
            leadsAtivos: Number(leadsRows?.[0]?.totalLeads || 0),
            oportunidadesAbertas: Number(oppsRows?.[0]?.totalOportunidades || 0),
            valorPipelineEstimado: Number(oppsRows?.[0]?.valorTotal || 0),
          };
        } catch {
          result.crm = { leadsAtivos: 0, oportunidadesAbertas: 0 };
        }
      }

      // 5. Cota e Consumo de Tokens de IA (Governança de Acesso)
      if (categoria === "todas" || categoria === "ia_tokens") {
        try {
          const usageSummary = await getAiTokenUsageSummary(tenantId, pool);
          const isAdmin = context.userRole === "admin";
          if (isAdmin) {
            result.iaTokens = {
              limiteMensal: usageSummary.summary.total_limit,
              totalConsumido: usageSummary.summary.total_used,
              saldoDisponivel: usageSummary.summary.remaining_tokens,
              percentualUtilizado: `${usageSummary.summary.percent_used}%`,
              diasRestantesCiclo: usageSummary.summary.days_remaining,
              dataRenovacao: usageSummary.summary.cycle_renewal_date,
            };
          } else {
            result.iaTokens = {
              status: "operacional",
              observacao: "Métricas detalhadas de cota contratual são visíveis apenas para administradores.",
            };
          }
        } catch {
          result.iaTokens = { status: "operacional" };
        }
      }

      return result;
    },
  });
  (metricsToolDef as any).parameters = getSystemMetricsSummaryParameters;
  tools.get_system_metrics_summary = metricsToolDef;

  // ─── Ferramenta 7: Criar e Registrar Tarefa Acionável do Dia ──────────────
  const createDailyTaskToolDef = tool({
    description:
      "Cria e registra uma nova tarefa prática e acionável no checklist de 'Tarefas do Dia' do Centro de Comando do operador/tenant. Use quando o usuário pedir para gerar um plano de ação, sugerir prioridades ou organizar as ações operacionais imediatas.",
    inputSchema: createDailyActionTaskParameters,
    execute: async (input: z.infer<typeof createDailyActionTaskParameters>) => {
      const tenantId = context.clientId;
      const taskId = `ai-task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const taskDate = new Date().toISOString().split("T")[0];
      const task = {
        id: taskId,
        title: input.title,
        priority: input.priority || "media",
        targetRoute: input.targetRoute || "home",
        suggestedByAi: true,
        completed: false,
        taskDate,
        createdAt: new Date().toISOString(),
      };

      try {
        if (pool) {
          await pool.execute(
            `CREATE TABLE IF NOT EXISTS megadesk_daily_action_tasks (
              id VARCHAR(80) PRIMARY KEY,
              tenant_id VARCHAR(80) NOT NULL,
              user_id VARCHAR(80) NOT NULL,
              title VARCHAR(255) NOT NULL,
              priority VARCHAR(20) NOT NULL DEFAULT 'media',
              target_route VARCHAR(50) NOT NULL DEFAULT 'home',
              completed BOOLEAN NOT NULL DEFAULT FALSE,
              task_date DATE NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_mddt_tenant_date (tenant_id, task_date)
            )`
          );

          await pool.execute(
            `INSERT INTO megadesk_daily_action_tasks
              (id, tenant_id, user_id, title, priority, target_route, completed, task_date)
             VALUES (?, ?, ?, ?, ?, ?, FALSE, ?)`,
            [
              task.id,
              tenantId,
              context.userId || "user",
              task.title,
              task.priority,
              task.targetRoute,
              taskDate,
            ]
          );
        }
      } catch {
        // Fallback resiliente caso o banco não esteja disponível no momento
      }

      return {
        success: true,
        message: `Tarefa registrada com sucesso no checklist do dia: "${input.title}" (Prioridade: ${input.priority}).`,
        task,
      };
    },
  });
  (createDailyTaskToolDef as any).parameters = createDailyActionTaskParameters;
  tools.create_daily_action_task = createDailyTaskToolDef;

  return tools;
}

