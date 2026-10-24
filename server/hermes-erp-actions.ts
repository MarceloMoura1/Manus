import { randomUUID } from "node:crypto";
import { getEvolutionAdapter } from "./evolution-manager";
import type { HermesErpActionType } from "./gemini-client";
import { productInput, type OperationalRole } from "./modules/erp/contracts";
import { ErpService } from "./modules/erp/service";
import { ProductSupplierService } from "./modules/erp/product-suppliers/service";
import { purchaseDraftInput } from "./modules/erp/purchases/domain-contracts";
import { PurchaseService } from "./modules/erp/purchases/service";
import { serviceUpdateInput } from "./modules/erp/services/contracts";
import { ServiceService } from "./modules/erp/services/service";
import { supplierInput } from "./modules/erp/suppliers/contracts";
import { SupplierService } from "./modules/erp/suppliers/service";

export type HermesErpAction = { actionType: HermesErpActionType; args: Record<string, unknown> };
type Identity = { clientId: string; userId: string; role: OperationalRole; userName?: string };
const products = new ErpService();
const productSuppliers = new ProductSupplierService();
const services = new ServiceService();
const suppliers = new SupplierService();
const purchases = new PurchaseService();
const required = (args: Record<string, unknown>, key: string) => {
  const value = args[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`HERMES_ERP_INVALID_${key.toUpperCase()}`); return value.trim();
};
const cents = (value: unknown, key: string) => {
  const amount = Number(value); if (!Number.isFinite(amount) || amount < 0) throw new Error(`HERMES_ERP_INVALID_${key.toUpperCase()}`); return Math.round(amount * 100);
};
function actor(input: { tenantId: string; userId: string; userName: string; role: OperationalRole }): Identity {
  if (!input.tenantId || !input.userId) throw new Error("HERMES_ERP_IDENTITY_REQUIRED");
  return { clientId: input.tenantId, userId: input.userId, userName: input.userName, role: input.role };
}
function productCommand(value: Record<string, unknown>) {
  return productInput.parse({ name: value.name, sku: value.sku, barcode: null, description: null, category: value.category ?? null, categoryPublicId: null, brandPublicId: null, unit: value.unit, costPriceCents: cents(value.costPrice, "cost_price"), salePriceCents: cents(value.salePrice, "sale_price"), minimumStock: String(value.initialStock ?? 0) });
}
function supplierCommand(value: Record<string, unknown>) {
  const document = required(value, "document"); const digits = document.replace(/\D/g, "");
  return supplierInput.parse({ legalName: required(value, "name"), tradeName: required(value, "name"), personType: digits.length === 14 ? "legal" : "individual", taxId: document, phone: typeof value.phone === "string" ? value.phone : null, email: typeof value.email === "string" ? value.email : null, contactName: typeof value.contactName === "string" ? value.contactName : null, stateRegistration: null, postalCode: null, street: null, addressNumber: null, addressComplement: null, district: null, city: null, state: null, notes: null });
}
export async function executeHermesErpAction(input: { tenantId: string; userId: string; userName: string; role: OperationalRole; action: HermesErpAction }): Promise<{ success: true; message: string; entityId: string | number }> {
  const identity = actor(input); const args = input.action.args;
  if (input.action.actionType === "CREATE_PRODUCT") {
    const product = await products.createProduct(identity, productCommand(args));
    if (Number(args.initialStock ?? 0) > 0) await products.moveStock(identity, { productPublicId: product.publicId, inventoryItemPublicId: null, type: "initial", quantity: String(args.initialStock), reason: "Estoque inicial aprovado via Hermes", idempotencyKey: randomUUID() });
    return { success: true, message: "Produto criado com sucesso.", entityId: product.publicId };
  }
  if (input.action.actionType === "UPDATE_PRODUCT") {
    const current = await products.getProduct(identity, required(args, "productId")); const fields = args.fieldsToUpdate as Record<string, unknown>;
    const product = await products.updateProduct(identity, current.publicId, productInput.parse({ name: fields.name ?? current.name, sku: fields.sku ?? current.sku, barcode: fields.barcode ?? current.barcode, description: fields.description ?? current.description, category: fields.category ?? current.category, categoryPublicId: fields.categoryPublicId ?? current.categoryPublicId, brandPublicId: fields.brandPublicId ?? current.brandPublicId, unit: fields.unit ?? current.unit, costPriceCents: fields.costPriceCents ?? current.costPriceCents, salePriceCents: fields.salePriceCents ?? current.salePriceCents, minimumStock: fields.minimumStock ?? current.minimumStock }));
    return { success: true, message: "Produto atualizado com sucesso.", entityId: product.publicId };
  }
  if (input.action.actionType === "LINK_PRODUCT_SUPPLIER") {
    const link = await productSuppliers.create(identity, { productPublicId: required(args, "productId"), supplierPublicId: required(args, "supplierId"), supplierProductCode: null, costPriceCents: null, isPreferred: false, active: true });
    return { success: true, message: "Fornecedor vinculado ao produto.", entityId: link.publicId };
  }
  if (input.action.actionType === "UPDATE_SERVICE") {
    const update = serviceUpdateInput.parse({ id: Number(args.serviceId), ...(args.fieldsToUpdate as Record<string, unknown>) });
    const { id, ...fields } = update; const service = await services.update(identity, id, fields);
    return { success: true, message: "Serviço atualizado com sucesso.", entityId: service.id };
  }
  if (input.action.actionType === "CREATE_SUPPLIER") {
    const supplier = await suppliers.create(identity, supplierCommand(args));
    return { success: true, message: "Fornecedor criado com sucesso.", entityId: supplier.publicId };
  }
  if (input.action.actionType === "UPDATE_SUPPLIER") {
    const current = await suppliers.detail(identity, required(args, "supplierId")); const fields = args.fieldsToUpdate as Record<string, unknown>;
    const supplier = await suppliers.update(identity, current.publicId, supplierInput.parse({ ...current, ...fields, legalName: fields.name ?? fields.legalName ?? current.legalName, taxId: fields.document ?? fields.taxId ?? current.taxId, personType: current.personType }));
    return { success: true, message: "Fornecedor atualizado com sucesso.", entityId: supplier.publicId };
  }
  if (input.action.actionType === "REQUEST_PURCHASE") {
    const items = args.items as Array<Record<string, unknown>>;
    const order = await purchases.create(identity, purchaseDraftInput.parse({ supplierPublicId: required(args, "supplierId"), responsibleUserId: input.userId, notes: typeof args.notes === "string" ? args.notes : null, expectedDate: null, discountCents: 0, freightCents: 0, otherExpensesCents: 0, paymentTerms: null, installments: [], idempotencyKey: randomUUID(), items: items.map(item => ({ productPublicId: required(item, "productId"), inventoryItemPublicId: null, quantity: String(item.quantity), unitCostCents: cents(item.targetCost, "target_cost"), discountCents: 0 })) }));
    return { success: true, message: "Pedido de compra criado em rascunho.", entityId: order.publicId };
  }
  if (input.action.actionType === "SEND_SUPPLIER_MESSAGE") {
    await suppliers.detail(identity, required(args, "supplierId"));
    const result = await getEvolutionAdapter().sendMessage(input.tenantId, required(args, "recipientPhone"), required(args, "messageText"));
    if (!result.ok) throw new Error("HERMES_ERP_SUPPLIER_MESSAGE_FAILED");
    return { success: true, message: "Mensagem enviada ao fornecedor.", entityId: required(args, "supplierId") };
  }
  throw new Error("HERMES_ERP_ACTION_NOT_ALLOWED");
}
