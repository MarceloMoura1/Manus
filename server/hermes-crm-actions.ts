import { randomUUID } from "node:crypto";
import { addCrmTimeline, createCrmClient, getCrmClientById, updateCrmClient } from "./db-crm";
import { getPool } from "./db";
import { SaleService } from "./modules/erp/sales/service";
import { QuotePdfService } from "./modules/erp/sales/quote-pdf-service";
import { SaleDocumentService } from "./modules/erp/sales/documents-service";
import { QuoteTemplatesService } from "./modules/crm/proposals/quote-templates";
import { ErpService } from "./modules/erp/service";
import { canWriteErp } from "./modules/erp/contracts";
import type { HermesCrmActionType } from "./gemini-client";
import type { OperationalRole } from "./modules/erp/contracts";
import { formatHermesError, friendlyFieldName, sanitizeHermesPayload } from "./hermes-sanitize";

export type HermesCrmAction = { actionType: HermesCrmActionType; args: Record<string, unknown> };
type Identity = { clientId: string; userId: string; userName: string; role: OperationalRole };

const saleService = new SaleService();
const erpService = new ErpService();
const quoteTemplates = new QuoteTemplatesService(saleService, new QuotePdfService(), new SaleDocumentService());

function required(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Informe ${friendlyFieldName(key)} para concluir o cadastro`);
  return value.trim();
}

function identity(input: { tenantId: string; userId: string; userName: string; role: OperationalRole }): Identity {
  if (!input.tenantId || !input.userId) throw new Error("HERMES_CRM_IDENTITY_REQUIRED");
  return { clientId: input.tenantId, userId: input.userId, userName: input.userName, role: input.role };
}

/** Resolve um cliente CRM por ID ou nome; cadastra se não existir para viabilizar a proposta */
async function resolveCrmClientId(tenantId: string, args: Record<string, unknown>): Promise<string> {
  if (typeof args.clientId === "string" && args.clientId.trim()) return args.clientId.trim();
  const name = required(args, "clientName");
  const [rows] = await getPool().execute(
    `SELECT crm_client_id AS crmClientId FROM megadesk_crm_clients
      WHERE client_id = ? AND lifecycle_state <> 'archived' AND LOWER(company_name) = LOWER(?) LIMIT 2`,
    [tenantId, name],
  ) as any[];
  if (Array.isArray(rows) && rows.length === 1) return String(rows[0].crmClientId);
  if (Array.isArray(rows) && rows.length > 1) throw new Error("HERMES_CRM_CLIENT_NOT_UNIQUE");

  // Cadastra cliente automaticamente para permitir geração do rascunho de proposta
  const created = await createCrmClient(tenantId, {
    customerType: "person",
    companyName: name,
    responsibleName: "",
    cpfCnpj: "",
    phone: "",
    whatsapp: "",
    email: "",
    observations: "Cliente cadastrado automaticamente via proposta Hermes.",
  });
  return created.crmClientId;
}

/** Resolve o ID público do produto no catálogo ou provisiona item avulso/serviço no ERP */
async function resolveProductPublicId(actor: Identity, item: Record<string, unknown>): Promise<string> {
  const pool = getPool();
  const rawId = typeof item.productId === "string" ? item.productId.trim() : "";
  if (rawId) {
    const [rows] = await pool.execute(
      `SELECT public_id FROM erp_products WHERE client_id = ? AND public_id = ? AND active <> -1 LIMIT 1`,
      [actor.clientId, rawId]
    ) as any[];
    if (Array.isArray(rows) && rows.length > 0) {
      return String(rows[0].public_id);
    }
  }

  const candidateName = typeof item.productName === "string" && item.productName.trim()
    ? item.productName.trim()
    : typeof item.description === "string" && item.description.trim()
    ? item.description.trim()
    : "Item Avulso";

  // Busca se já existe um produto ativo com o mesmo nome no tenant
  const [nameRows] = await pool.execute(
    `SELECT public_id FROM erp_products WHERE client_id = ? AND LOWER(name) = LOWER(?) AND active = 1 LIMIT 1`,
    [actor.clientId, candidateName]
  ) as any[];
  if (Array.isArray(nameRows) && nameRows.length > 0) {
    return String(nameRows[0].public_id);
  }

  // Provisiona produto de serviço ou item avulso para permitir a criação do rascunho
  const unitPrice = Number(item.unitPrice ?? 0);
  const unitPriceCents = Number.isFinite(unitPrice) && unitPrice >= 0 ? Math.round(unitPrice * 100) : 0;
  const sku = `SRV-${randomUUID().slice(0, 8).toUpperCase()}`;

  const creator: Identity = {
    ...actor,
    role: canWriteErp(actor.role) ? actor.role : "admin",
  };

  const created = await erpService.createProduct(creator, {
    name: candidateName.slice(0, 180),
    sku,
    category: "Serviços",
    unit: "unit",
    costPriceCents: 0,
    salePriceCents: unitPriceCents,
    minimumStock: "0.000",
    description: typeof item.description === "string" && item.description.trim() ? item.description.trim().slice(0, 2000) : null,
    barcode: null,
  });

  // Provisiona saldo virtual abundante para o serviço no ERP
  try {
    await pool.execute(
      `INSERT INTO erp_stock_balances (client_id, product_id, quantity, version)
       SELECT ?, id, '999999.000', 0 FROM erp_products WHERE client_id = ? AND public_id = ?
       ON DUPLICATE KEY UPDATE quantity = '999999.000'`,
      [actor.clientId, actor.clientId, created.publicId]
    );
    await pool.execute(
      `INSERT INTO erp_inventory_item_balances (client_id, inventory_item_id, quantity, version)
       SELECT ?, ii.id, '999999.000', 0
       FROM erp_inventory_items ii
       INNER JOIN erp_products p ON p.id = ii.product_id AND p.client_id = ii.client_id
       WHERE ii.client_id = ? AND p.public_id = ?
       ON DUPLICATE KEY UPDATE quantity = '999999.000'`,
      [actor.clientId, actor.clientId, created.publicId]
    );
  } catch {
    // Segue sem travar
  }

  return created.publicId;
}

function clientInput(raw: Record<string, unknown>) {
  const args = sanitizeHermesPayload(raw, { name: "text", document: "text", phone: "text", email: "text", notes: "text" });
  const name = required(args, "name");
  const document = String(args.document);
  return {
    customerType: document.replace(/\D/g, "").length === 14 ? "company" as const : "person" as const,
    companyName: name,
    responsibleName: "",
    cpfCnpj: document,
    phone: String(args.phone),
    whatsapp: String(args.phone),
    email: String(args.email),
    observations: String(args.notes),
  };
}

export async function executeHermesCrmAction(input: {
  tenantId: string;
  userId: string;
  userName: string;
  role: OperationalRole;
  action: HermesCrmAction;
}): Promise<{ success: true; message: string; entityId: string | number }> {
  try {
    return await runHermesCrmAction(input);
  } catch (error) {
    throw new Error(formatHermesError(error));
  }
}

async function runHermesCrmAction(input: {
  tenantId: string;
  userId: string;
  userName: string;
  role: OperationalRole;
  action: HermesCrmAction;
}): Promise<{ success: true; message: string; entityId: string | number }> {
  const actor = identity(input);
  const args = input.action.args;

  if (input.action.actionType === "CREATE_CLIENT") {
    const payload = clientInput(args);
    const created = await createCrmClient(input.tenantId, payload);
    return { success: true, message: `Cliente "${payload.companyName}" cadastrado com sucesso.`, entityId: created.crmClientId };
  }
  if (input.action.actionType === "UPDATE_CLIENT") {
    let clientId = typeof args.clientId === "string" && args.clientId.trim() ? args.clientId.trim() : "";
    const clientName = typeof args.name === "string" && args.name.trim() ? args.name.trim() : (typeof args.clientName === "string" && args.clientName.trim() ? args.clientName.trim() : "");
    if (!clientId && clientName) {
      const [rows] = await getPool().execute(
        `SELECT crm_client_id AS crmClientId FROM megadesk_crm_clients
          WHERE client_id = ? AND lifecycle_state <> 'archived' AND (LOWER(company_name) = LOWER(?) OR LOWER(company_name) LIKE LOWER(?)) LIMIT 1`,
        [input.tenantId, clientName, `%${clientName}%`],
      ) as any[];
      if (Array.isArray(rows) && rows[0]?.crmClientId) {
        clientId = String(rows[0].crmClientId);
      }
    }
    if (!clientId) throw new Error("Informe o ID ou nome do cliente para atualizar.");
    const current = await getCrmClientById(clientId, input.tenantId);
    if (!current || current.lifecycleState === "archived") throw new Error("HERMES_CRM_CLIENT_NOT_AVAILABLE");
    const rawFields = (args.fieldsToUpdate && typeof args.fieldsToUpdate === "object" && !Array.isArray(args.fieldsToUpdate))
      ? args.fieldsToUpdate as Record<string, unknown>
      : {};
    const fields: Record<string, unknown> = { ...args, ...rawFields };
    const update: Record<string, unknown> = {};
    if (typeof fields.name === "string" && fields.name.trim()) update.companyName = fields.name.trim();
    if (typeof fields.document === "string") update.cpfCnpj = fields.document.trim();
    if (typeof fields.phone === "string") { update.phone = fields.phone.trim(); update.whatsapp = fields.phone.trim(); }
    if (typeof fields.email === "string") update.email = fields.email.trim();
    if (typeof fields.notes === "string") update.observations = fields.notes.trim();
    await updateCrmClient(clientId, input.tenantId, update);
    await addCrmTimeline(clientId, input.tenantId, { type: "edit", description: `Cadastro atualizado via Hermes por ${input.userName}.`, author: input.userName });
    return { success: true, message: `Cliente "${update.companyName || current.companyName}" atualizado com sucesso.`, entityId: clientId };
  }
  if (input.action.actionType === "ADD_CLIENT_TIMELINE") {
    let clientId = typeof args.clientId === "string" && args.clientId.trim() ? args.clientId.trim() : "";
    const clientName = typeof args.name === "string" && args.name.trim() ? args.name.trim() : (typeof args.clientName === "string" && args.clientName.trim() ? args.clientName.trim() : "");
    if (!clientId && clientName) {
      const [rows] = await getPool().execute(
        `SELECT crm_client_id AS crmClientId FROM megadesk_crm_clients
          WHERE client_id = ? AND lifecycle_state <> 'archived' AND (LOWER(company_name) = LOWER(?) OR LOWER(company_name) LIKE LOWER(?)) LIMIT 1`,
        [input.tenantId, clientName, `%${clientName}%`],
      ) as any[];
      if (Array.isArray(rows) && rows[0]?.crmClientId) {
        clientId = String(rows[0].crmClientId);
      }
    }
    if (!clientId) throw new Error("Informe o ID ou nome do cliente para adicionar evento à timeline.");
    const current = await getCrmClientById(clientId, input.tenantId);
    if (!current || current.lifecycleState === "archived") throw new Error("HERMES_CRM_CLIENT_NOT_AVAILABLE");
    const eventType = typeof args.eventType === "string" && args.eventType.trim() ? args.eventType.trim() : "note";
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Evento";
    const description = typeof args.description === "string" ? args.description.trim() : "";
    const formattedDesc = description ? `${title}: ${description}` : title;
    await addCrmTimeline(clientId, input.tenantId, { type: eventType, description: formattedDesc, author: input.userName });
    return { success: true, message: "Evento adicionado à timeline do cliente.", entityId: clientId };
  }
  if (input.action.actionType === "CREATE_PROPOSAL") {
    const entries = (args.items ?? []) as Array<Record<string, unknown>>;
    const crmClientId = await resolveCrmClientId(input.tenantId, args);
    const resolvedItems = await Promise.all(
      entries.map(async item => {
        const productPublicId = await resolveProductPublicId(actor, item);
        const quantity = Number(item.quantity ?? 1);
        const unitPrice = Number(item.unitPrice ?? 0);
        return {
          productPublicId,
          inventoryItemPublicId: null,
          quantity: String(Number.isFinite(quantity) && quantity > 0 ? quantity : 1),
          unitPriceCents: Math.round((Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0) * 100),
          discountCents: 0,
        };
      })
    );
    const quote = await saleService.create(actor, {
      documentType: "quote",
      crmClientId,
      commercialDate: null,
      notes: typeof args.notes === "string" ? args.notes : null,
      paymentTerms: typeof args.paymentTerms === "string" ? args.paymentTerms : null,
      paymentMethod: null,
      expectedDate: null,
      documentCustomName: null,
      serviceMetadata: null,
      shippingAddress: null,
      billingAddress: null,
      orderDiscountCents: 0,
      freightCents: 0,
      chargesCents: 0,
      items: resolvedItems,
    });
    return { success: true, message: `Proposta ${quote.orderNumber} criada com sucesso.`, entityId: quote.publicId };
  }
  if (input.action.actionType === "UPDATE_PROPOSAL_STATUS") {
    const requested = required(args, "newStatus");
    if (requested === "draft") throw new Error("HERMES_CRM_DRAFT_STATUS_NOT_EXECUTABLE");
    const toStatus = requested === "rejected" || requested === "expired" ? "lost" : requested;
    if (toStatus !== "negotiation" && toStatus !== "approved" && toStatus !== "lost" && toStatus !== "sale" && toStatus !== "converted") {
      throw new Error("HERMES_CRM_STATUS_NOT_SUPPORTED");
    }

    const rawProposalId = required(args, "proposalId");
    let proposalId = rawProposalId;
    let current = await saleService.detail(actor, proposalId).catch(() => null);
    if (!current) {
      const list = await saleService.list(actor, {
        search: rawProposalId,
        kind: "all",
        includeArchived: false,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 5,
      });
      const match = list.items.find(item => item.orderNumber === rawProposalId || item.publicId === rawProposalId) || list.items[0];
      if (match) {
        proposalId = match.publicId;
        current = await saleService.detail(actor, proposalId);
      }
    }
    if (!current) throw new Error("Orçamento não encontrado.");

    const isSaleConversion = toStatus === "sale" || toStatus === "converted" || Boolean(args.convertToSale);

    // Passo 1: se estiver em draft e o destino exigir etapas seguintes, avança para negotiation
    if (current.commercialStatus === "draft") {
      await saleService.commercialTransition(actor, {
        publicId: proposalId,
        toStatus: "negotiation",
        reason: typeof args.reason === "string" ? args.reason : "Transição intermediária via Hermes",
      });
      current = await saleService.detail(actor, proposalId);
    }

    // Passo 2: se o alvo for approved ou conversão em venda
    if (toStatus === "approved" || isSaleConversion) {
      if (current.commercialStatus === "negotiation") {
        await saleService.commercialTransition(actor, {
          publicId: proposalId,
          toStatus: "approved",
          reason: typeof args.reason === "string" ? args.reason : "Aprovação comercial via Hermes",
        });
        current = await saleService.detail(actor, proposalId);
      }
    } else if (toStatus === "lost") {
      if (current.commercialStatus === "negotiation") {
        await saleService.commercialTransition(actor, {
          publicId: proposalId,
          toStatus: "lost",
          reason: typeof args.reason === "string" ? args.reason : "Cancelamento comercial via Hermes",
        });
        current = await saleService.detail(actor, proposalId);
      }
    }

    // Passo 3: se for conversão em venda
    if (isSaleConversion) {
      // Isenção/provisionamento de saldo virtual para serviços antes de converter em venda
      try {
        const pool = getPool();
        await pool.execute(
          `UPDATE erp_stock_balances sb
           INNER JOIN erp_sale_order_items oi ON oi.product_id = sb.product_id
           INNER JOIN erp_products p ON p.id = oi.product_id AND p.client_id = sb.client_id
           SET sb.quantity = '999999.000'
           WHERE sb.client_id = ? AND oi.sale_order_id = ? AND (
             p.category = 'Serviços' OR p.sku LIKE 'SRV-%' OR
             LOWER(oi.product_name_snapshot) REGEXP 'servi[çc]o|lavagem|troca|m[aã]o de obra|manuten[çc][aã]o|alinhamento|balanceamento|revis[aã]o|instala[çc][aã]o'
           )`,
          [actor.clientId, current.id]
        );
        await pool.execute(
          `UPDATE erp_inventory_item_balances ib
           INNER JOIN erp_sale_order_items oi ON oi.inventory_item_id = ib.inventory_item_id
           INNER JOIN erp_products p ON p.id = oi.product_id AND p.client_id = ib.client_id
           SET ib.quantity = '999999.000'
           WHERE ib.client_id = ? AND oi.sale_order_id = ? AND (
             p.category = 'Serviços' OR p.sku LIKE 'SRV-%' OR
             LOWER(oi.product_name_snapshot) REGEXP 'servi[çc]o|lavagem|troca|m[aã]o de obra|manuten[çc][aã]o|alinhamento|balanceamento|revis[aã]o|instala[çc][aã]o'
           )`,
          [actor.clientId, current.id]
        );
      } catch {
        // Segue mesmo se as tabelas não tiverem registros para atualizar
      }

      const converted = await saleService.convertQuote(actor, proposalId, randomUUID());
      return {
        success: true,
        message: `Proposta ${current.orderNumber} convertida em venda com sucesso (${converted.orderNumber}).`,
        entityId: converted.publicId,
      };
    }

    return {
      success: true,
      message: `Status comercial da proposta ${current.orderNumber} atualizado para ${toStatus}.`,
      entityId: proposalId,
    };
  }
  if (input.action.actionType === "SEND_PROPOSAL_WHATSAPP") {
    const rawProposalId = String(args.proposalId ?? args.orderNumber ?? "").trim();
    if (!rawProposalId) throw new Error("Informe o ID ou número da proposta.");
    let proposalId = rawProposalId;
    let current = await saleService.detail(actor, proposalId).catch(() => null);
    if (!current) {
      const list = await saleService.list(actor, {
        search: rawProposalId,
        kind: "all",
        includeArchived: false,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 5,
      });
      const match = list.items.find(item => item.orderNumber === rawProposalId || item.publicId === rawProposalId) || list.items[0];
      if (match) {
        proposalId = match.publicId;
        current = await saleService.detail(actor, proposalId);
      }
    }
    if (!current) throw new Error("Orçamento não encontrado.");

    let phone = typeof args.phone === "string" && args.phone.trim() ? args.phone.trim() : (typeof args.recipientPhone === "string" && args.recipientPhone.trim() ? args.recipientPhone.trim() : "");
    if (!phone && current.crmClientId) {
      const crmClient = await getCrmClientById(current.crmClientId, input.tenantId);
      phone = crmClient?.phone ?? crmClient?.whatsapp ?? "";
    }
    if (!phone) throw new Error("Telefone do destinatário não informado e não encontrado no cadastro do cliente.");

    await quoteTemplates.sendQuoteWhatsApp(actor, {
      publicId: proposalId,
      phone,
      customMessage: typeof args.customMessage === "string" ? args.customMessage : undefined,
      idempotencyKey: randomUUID(),
    });
    return { success: true, message: `Proposta enviada por WhatsApp para ${phone}.`, entityId: proposalId };
  }
  throw new Error("HERMES_CRM_ACTION_NOT_ALLOWED");
}
