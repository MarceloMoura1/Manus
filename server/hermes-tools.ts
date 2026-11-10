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
  userEmail?: string;
  operationalUserId?: string;
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

  return tools;
}

