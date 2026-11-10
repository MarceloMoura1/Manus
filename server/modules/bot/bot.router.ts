/**
 * Bot Module — Typebot & Universal Bot Webhook & Tool Routes
 * Fornece endpoints HTTP para integração com Typebot:
 * - POST /api/bot/typebot-webhook: Recebe eventos do Typebot (transferência humana, etc.)
 * - GET  /api/bot/tools/products: Consulta produtos e estoque do ERP
 * - GET  /api/bot/tools/tickets: Consulta últimos chamados por telefone
 * - POST /api/bot/tools/leads: Cria ou atualiza leads no CRM
 */
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { getPool, validateMegaDeskClientToken } from "../../db";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";

/**
 * Helper para extrair clientId e autenticar tenant.
 */
export async function resolveTenantAuth(req: Request): Promise<{ clientId: string } | null> {
  const headerTenant = req.headers["x-tenant-id"] as string | undefined;
  const queryTenant = req.query.clientId as string | undefined;
  const bodyTenant = req.body?.clientId as string | undefined;
  const clientId = (headerTenant || queryTenant || bodyTenant || "").trim();

  if (!clientId) return null;

  // Se houver token fornecido, valida contra o banco
  const authHeader = req.headers.authorization;
  const xApiToken = req.headers["x-api-token"] as string | undefined;
  const queryToken = (req.query.token || req.query.apiToken) as string | undefined;
  const bodyToken = req.body?.token as string | undefined;

  let token = xApiToken || queryToken || bodyToken;
  if (!token && authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  if (token) {
    const client = await validateMegaDeskClientToken(clientId, token);
    if (!client) return null;
  }

  return { clientId };
}

// ─── 1. WEBHOOK TYPEBOT ───────────────────────────────────────────────────
export async function handleTypebotWebhook(req: Request, res: Response): Promise<Response> {
  try {
    const payload = req.body ?? {};
    const action = String(payload.action || payload.event || payload.type || "").trim();
    const clientId = String(payload.clientId || req.headers["x-tenant-id"] || req.query.clientId || "").trim();
    const conversationId = payload.conversationId ? String(payload.conversationId).trim() : null;
    const phone = payload.phone ? String(payload.phone).replace(/\D/g, "") : null;

    if (!clientId) {
      return res.status(400).json({ error: "clientId é obrigatório." });
    }

    // Ação de transbordo para atendente humano
    if (action === "transfer_to_human") {
      const pool = getPool();
      let targetConversationId = conversationId;

      if (!targetConversationId && phone) {
        const [convRows] = await pool.execute(
          `SELECT conversation_id FROM megadesk_domain_conversations
           WHERE client_id = ? AND (phone = ? OR phone LIKE ?) AND status IN ('open', 'bot')
           ORDER BY updated_at DESC LIMIT 1`,
          [clientId, phone, `%${phone.slice(-8)}`]
        ) as any[];

        if (convRows.length > 0) {
          targetConversationId = convRows[0].conversation_id;
        }
      }

      if (targetConversationId) {
        // Marca a conversa para atendimento humano e silencia o bot por 24 horas
        await pool.execute(
          `UPDATE megadesk_domain_conversations
           SET status = 'open',
               assigned_user_id = NULL,
               assigned_user_name = NULL,
               ia_active = 0,
               bot_suspended_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
               updated_at = NOW()
           WHERE conversation_id = ? AND client_id = ?`,
          [targetConversationId, clientId]
        );

        // Dispara eventos em tempo real no Socket.IO (/api/ws/whatsapp)
        const eventPayload = {
          conversationId: targetConversationId,
          phone,
          status: "AGUARDANDO_HUMANO",
          reason: payload.reason || payload.note || "Transferido via Typebot",
          timestamp: new Date().toISOString(),
        };

        emitOperationalTenantEvent(clientId, "wa:transfer_to_human", eventPayload);
        emitOperationalTenantEvent(clientId, "wa:conversation_updated", {
          conversation: {
            id: targetConversationId,
            status: "AGUARDANDO_HUMANO",
            assignedUserId: null,
            iaActive: 0,
          },
        });
      }

      return res.status(200).json({
        ok: true,
        action: "transfer_to_human",
        status: "AGUARDANDO_HUMANO",
        conversationId: targetConversationId,
        message: "Transbordo para fila humana concluído e bot silenciado.",
      });
    }

    return res.status(200).json({ ok: true, received: true, action });
  } catch (error: any) {
    console.error("[BotWebhook] Erro ao processar typebot-webhook:", error);
    return res.status(500).json({ error: error?.message || "Erro interno ao processar webhook" });
  }
}

// ─── 2. TOOLS: CONSULTA DE PRODUTOS/SERVIÇOS ERP ──────────────────────────
export async function handleGetProducts(req: Request, res: Response): Promise<Response> {
  try {
    const auth = await resolveTenantAuth(req);
    if (!auth) {
      return res.status(401).json({ error: "Credenciais de tenant ausentes ou inválidas." });
    }

    const search = String(req.query.search || "").trim();
    const pool = getPool();

    const searchPattern = `%${search}%`;
    const [rows] = await pool.execute(
      `SELECT 
         p.name,
         ROUND(COALESCE(p.sale_price_cents, 0) / 100.0, 2) AS price,
         COALESCE(sb.quantity, 0) AS stock_quantity
       FROM erp_products p
       LEFT JOIN erp_stock_balances sb ON sb.client_id = p.client_id AND sb.product_id = p.id
       WHERE p.client_id = ? AND p.active = 1
         AND (? = '' OR p.name LIKE ? OR p.sku LIKE ?)
       ORDER BY p.name ASC
       LIMIT 25`,
      [auth.clientId, search, searchPattern, searchPattern]
    ) as any[];

    const products = rows.map((r: any) => ({
      name: String(r.name || ""),
      price: Number(r.price || 0),
      inStock: Number(r.stock_quantity || 0) > 0,
    }));

    return res.status(200).json(products);
  } catch (error: any) {
    console.error("[BotTools] Erro ao consultar produtos:", error);
    return res.status(500).json({ error: "Falha ao consultar produtos do ERP." });
  }
}

// ─── 3. TOOLS: CONSULTA DE CHAMADOS (TICKETS) ─────────────────────────────
export async function handleGetTickets(req: Request, res: Response): Promise<Response> {
  try {
    const auth = await resolveTenantAuth(req);
    if (!auth) {
      return res.status(401).json({ error: "Credenciais de tenant ausentes ou inválidas." });
    }

    const phoneRaw = String(req.query.phone || "").trim();
    const phoneDigits = phoneRaw.replace(/\D/g, "");

    if (!phoneDigits) {
      return res.status(400).json({ error: "Parâmetro phone é obrigatório." });
    }

    const pool = getPool();
    const phoneSuffix = phoneDigits.slice(-8);

    const [rows] = await pool.execute(
      `SELECT 
         chamado_id AS id,
         chamado_number AS number,
         title,
         status,
         created_at AS createdAt
       FROM megadesk_domain_chamados
       WHERE client_id = ?
         AND (
           customer_phone = ? 
           OR customer_phone LIKE ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(customer_phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
         )
       ORDER BY chamado_number DESC
       LIMIT 10`,
      [auth.clientId, phoneRaw, `%${phoneSuffix}`, `%${phoneSuffix}%`]
    ) as any[];

    const statusMap: Record<string, string> = {
      open: "Aberto",
      in_progress: "Em Andamento",
      waiting: "Aguardando",
      closed: "Encerrado",
    };

    const tickets = rows.map((r: any) => ({
      id: String(r.id),
      number: Number(r.number),
      title: String(r.title || "Sem título"),
      status: statusMap[r.status] || r.status || "Aberto",
      statusRaw: r.status,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    }));

    return res.status(200).json(tickets);
  } catch (error: any) {
    console.error("[BotTools] Erro ao consultar chamados:", error);
    return res.status(500).json({ error: "Falha ao consultar chamados." });
  }
}

// ─── 4. TOOLS: CRIAÇÃO / ATUALIZAÇÃO DE LEADS NO CRM ──────────────────────
export async function handleCreateOrUpdateLead(req: Request, res: Response): Promise<Response> {
  try {
    const auth = await resolveTenantAuth(req);
    if (!auth) {
      return res.status(401).json({ error: "Credenciais de tenant ausentes ou inválidas." });
    }

    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    const notes = String(req.body?.notes || req.body?.observations || "").trim();

    if (!phone && !name) {
      return res.status(400).json({ error: "Pelo menos o nome ou telefone deve ser fornecido." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const pool = getPool();

    // Verifica se lead já existe pelo telefone
    let existingLeadId: string | null = null;
    let existingNotes = "";

    if (cleanPhone) {
      const phoneSuffix = cleanPhone.slice(-8);
      const [existingRows] = await pool.execute(
        `SELECT crm_client_id, observations FROM megadesk_crm_clients
         WHERE client_id = ?
           AND (
             phone = ? OR whatsapp = ?
             OR REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
             OR REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
           )
         LIMIT 1`,
        [auth.clientId, phone, phone, `%${phoneSuffix}%`, `%${phoneSuffix}%`]
      ) as any[];

      if (existingRows.length > 0) {
        existingLeadId = existingRows[0].crm_client_id;
        existingNotes = existingRows[0].observations || "";
      }
    }

    if (existingLeadId) {
      // Atualiza lead existente
      const updatedNotes = notes
        ? (existingNotes ? `${existingNotes}\n[Typebot ${new Date().toLocaleDateString('pt-BR')}]: ${notes}` : notes)
        : existingNotes;

      await pool.execute(
        `UPDATE megadesk_crm_clients
         SET company_name = COALESCE(NULLIF(?, ''), company_name),
             responsible_name = COALESCE(NULLIF(?, ''), responsible_name),
             email = COALESCE(NULLIF(?, ''), email),
             observations = ?,
             updated_at = NOW()
         WHERE crm_client_id = ? AND client_id = ?`,
        [name, name, email, updatedNotes, existingLeadId, auth.clientId]
      );

      return res.status(200).json({
        ok: true,
        action: "updated",
        lead: {
          crmClientId: existingLeadId,
          name,
          phone,
          email,
        },
      });
    }

    // Cria novo lead
    const newCrmClientId = crypto.randomUUID();
    const leadName = name || (phone ? `Lead ${phone}` : "Novo Lead Typebot");

    await pool.execute(
      `INSERT INTO megadesk_crm_clients (
         crm_client_id, client_id, customer_type, company_name, responsible_name,
         phone, whatsapp, email, observations, origin, status, created_at, updated_at
       ) VALUES (?, ?, 'person', ?, ?, ?, ?, ?, ?, 'whatsapp', 'lead', NOW(), NOW())`,
      [
        newCrmClientId,
        auth.clientId,
        leadName,
        name || "",
        phone,
        phone,
        email,
        notes ? `[Typebot]: ${notes}` : "",
      ]
    );

    return res.status(201).json({
      ok: true,
      action: "created",
      lead: {
        crmClientId: newCrmClientId,
        name: leadName,
        phone,
        email,
      },
    });
  } catch (error: any) {
    console.error("[BotTools] Erro ao salvar lead:", error);
    return res.status(500).json({ error: "Falha ao registrar lead no CRM." });
  }
}

export function createBotRouter(): Router {
  const router = Router();
  router.post("/typebot-webhook", handleTypebotWebhook);
  router.get("/tools/products", handleGetProducts);
  router.get("/tools/tickets", handleGetTickets);
  router.post("/tools/leads", handleCreateOrUpdateLead);
  return router;
}

export function registerBotRoutes(app: { use: (path: string, router: Router) => void }): void {
  app.use("/api/bot", createBotRouter());
}
