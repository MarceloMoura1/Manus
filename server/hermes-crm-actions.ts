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
    const clientId = required(args, "clientId");
    const current = await getCrmClientById(clientId, input.tenantId);
    if (!current || current.lifecycleState === "archived") throw new Error("HERMES_CRM_CLIENT_NOT_AVAILABLE");
    const fields = args.fieldsToUpdate as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (typeof fields.name === "string") update.companyName = fields.name;
    if (typeof fields.document === "string") update.cpfCnpj = fields.document;
    if (typeof fields.phone === "string") { update.phone = fields.phone; update.whatsapp = fields.phone; }
    if (typeof fields.email === "string") update.email = fields.email;
    if (typeof fields.notes === "string") update.observations = fields.notes;
    await updateCrmClient(clientId, input.tenantId, update);
    await addCrmTimeline(clientId, input.tenantId, { type: "edit", description: `Cadastro atualizado via Hermes por ${input.userName}.`, author: input.userName });
    return { success: true, message: "Cliente atualizado com sucesso.", entityId: clientId };
  }
  if (input.action.actionType === "ADD_CLIENT_TIMELINE") {
    const clientId = required(args, "clientId");
    const current = await getCrmClientById(clientId, input.tenantId);
    if (!current || current.lifecycleState === "archived") throw new Error("HERMES_CRM_CLIENT_NOT_AVAILABLE");
    await addCrmTimeline(clientId, input.tenantId, { type: required(args, "eventType"), description: `${required(args, "title")}: ${required(args, "description")}`, author: input.userName });
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
    if (toStatus !== "negotiation" && toStatus !== "approved" && toStatus !== "lost") throw new Error("HERMES_CRM_STATUS_NOT_SUPPORTED");
    const proposalId = required(args, "proposalId");
    await saleService.commercialTransition(actor, { publicId: proposalId, toStatus, reason: typeof args.reason === "string" ? args.reason : null });
    return { success: true, message: "Status comercial da proposta atualizado.", entityId: proposalId };
  }
  if (input.action.actionType === "SEND_PROPOSAL_WHATSAPP") {
    const proposalId = required(args, "proposalId");
    await quoteTemplates.sendQuoteWhatsApp(actor, {
      publicId: proposalId, phone: required(args, "recipientPhone"), customMessage: typeof args.customMessage === "string" ? args.customMessage : undefined, idempotencyKey: randomUUID(),
    });
    return { success: true, message: "Proposta enviada por WhatsApp.", entityId: proposalId };
  }
  throw new Error("HERMES_CRM_ACTION_NOT_ALLOWED");
}
