import { randomUUID } from "node:crypto";
import { addCrmTimeline, createCrmClient, getCrmClientById, updateCrmClient } from "./db-crm";
import { SaleService } from "./modules/erp/sales/service";
import { QuotePdfService } from "./modules/erp/sales/quote-pdf-service";
import { SaleDocumentService } from "./modules/erp/sales/documents-service";
import { QuoteTemplatesService } from "./modules/crm/proposals/quote-templates";
import type { HermesCrmActionType } from "./gemini-client";
import type { OperationalRole } from "./modules/erp/contracts";

export type HermesCrmAction = { actionType: HermesCrmActionType; args: Record<string, unknown> };
type Identity = { clientId: string; userId: string; userName: string; role: OperationalRole };

const saleService = new SaleService();
const quoteTemplates = new QuoteTemplatesService(saleService, new QuotePdfService(), new SaleDocumentService());

function required(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`HERMES_CRM_INVALID_${key.toUpperCase()}`);
  return value.trim();
}

function identity(input: { tenantId: string; userId: string; userName: string; role: OperationalRole }): Identity {
  if (!input.tenantId || !input.userId) throw new Error("HERMES_CRM_IDENTITY_REQUIRED");
  return { clientId: input.tenantId, userId: input.userId, userName: input.userName, role: input.role };
}

function clientInput(args: Record<string, unknown>) {
  const name = required(args, "name");
  const document = typeof args.document === "string" ? args.document : "";
  return {
    customerType: document.replace(/\D/g, "").length === 14 ? "company" as const : "person" as const,
    companyName: name,
    responsibleName: "",
    cpfCnpj: document,
    phone: typeof args.phone === "string" ? args.phone : "",
    whatsapp: typeof args.phone === "string" ? args.phone : "",
    email: typeof args.email === "string" ? args.email : "",
    observations: typeof args.notes === "string" ? args.notes : "",
  };
}

export async function executeHermesCrmAction(input: {
  tenantId: string;
  userId: string;
  userName: string;
  role: OperationalRole;
  action: HermesCrmAction;
}): Promise<{ success: true; message: string; entityId: string | number }> {
  const actor = identity(input);
  const args = input.action.args;

  if (input.action.actionType === "CREATE_CLIENT") {
    const created = await createCrmClient(input.tenantId, clientInput(args));
    return { success: true, message: "Cliente criado com sucesso.", entityId: created.crmClientId };
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
    const entries = args.items as Array<Record<string, unknown>>;
    const quote = await saleService.create(actor, {
      documentType: "quote", crmClientId: required(args, "clientId"), commercialDate: null,
      notes: typeof args.notes === "string" ? args.notes : null,
      paymentTerms: typeof args.paymentTerms === "string" ? args.paymentTerms : null,
      paymentMethod: null, expectedDate: null, documentCustomName: null, serviceMetadata: null,
      shippingAddress: null, billingAddress: null, orderDiscountCents: 0, freightCents: 0, chargesCents: 0,
      items: entries.map(item => ({ productPublicId: required(item, "productId"), inventoryItemPublicId: null, quantity: String(Number(item.quantity)), unitPriceCents: Math.round(Number(item.unitPrice) * 100), discountCents: 0 })),
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
