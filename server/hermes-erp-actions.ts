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
import { supplierInput, normalizeSupplierInput, type SupplierInput } from "./modules/erp/suppliers/contracts";
import { SupplierService } from "./modules/erp/suppliers/service";
import { serviceInput } from "./modules/erp/services/contracts";
import { formatHermesError, sanitizeHermesPayload } from "./hermes-sanitize";

export type HermesErpAction = { actionType: HermesErpActionType; args: Record<string, unknown> };
type Identity = { clientId: string; userId: string; role: OperationalRole; userName?: string };
const products = new ErpService();
const productSuppliers = new ProductSupplierService();
const services = new ServiceService();
const suppliers = new SupplierService();
const purchases = new PurchaseService();
const FIELD_NAMES: Record<string, string> = { name: "nome", document: "documento", supplierid: "fornecedor", productid: "produto", sku: "código (SKU)" };
const required = (args: Record<string, unknown>, key: string) => {
  const value = args[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`Informe ${FIELD_NAMES[key.toLowerCase()] ?? key} para concluir o cadastro`); return value.trim();
};
const cents = (value: unknown, key: string) => {
  const amount = Number(value ?? 0); if (!Number.isFinite(amount) || amount < 0) throw new Error(`Valor inválido para ${key}`); return Math.round(amount * 100);
};
function actor(input: { tenantId: string; userId: string; userName: string; role: OperationalRole }): Identity {
  if (!input.tenantId || !input.userId) throw new Error("HERMES_ERP_IDENTITY_REQUIRED");
  return { clientId: input.tenantId, userId: input.userId, userName: input.userName, role: input.role };
}
const textOrNull = (value: unknown) => { const text = typeof value === "string" ? value.trim() : ""; return text || null; };
function productCommand(raw: Record<string, unknown>) {
  const value = sanitizeHermesPayload(raw, { name: "text", sku: "text", category: "text", unit: "text", costPrice: "number", salePrice: "number", initialStock: "number" });
  const sku = textOrNull(value.sku) ?? `PRD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const unit = textOrNull(value.unit) ?? "unit";
  return productInput.parse({ name: value.name, sku, barcode: null, description: null, category: textOrNull(value.category), categoryPublicId: null, brandPublicId: null, unit, costPriceCents: cents(value.costPrice, "preço de custo"), salePriceCents: cents(value.salePrice, "preço de venda"), minimumStock: String(value.initialStock ?? 0) });
}
/** Fornecedor via Hermes: apenas o nome é obrigatório; demais campos são opcionais e aceitam null. */
function supplierCommand(raw: Record<string, unknown>): SupplierInput {
  const value = sanitizeHermesPayload(raw, { name: "text", document: "text", phone: "text", email: "text", contactName: "text", stateRegistration: "text", postalCode: "text", street: "text", addressNumber: "text", addressComplement: "text", district: "text", city: "text", state: "text", notes: "text" });
  const legalName = required(value, "name");
  const digits = String(value.document).replace(/\D/g, "").slice(0, 14);
  const email = textOrNull(value.email);
  const uf = String(value.state).trim().toUpperCase();
  return normalizeSupplierInput({
    legalName, tradeName: textOrNull(value.tradeName) ?? legalName,
    personType: digits.length === 11 ? "individual" : "legal",
    taxId: digits || null, stateRegistration: textOrNull(value.stateRegistration),
    email: email && /^\S+@\S+\.\S+$/.test(email) ? email : null,
    phone: textOrNull(value.phone), contactName: textOrNull(value.contactName),
    postalCode: textOrNull(String(value.postalCode).replace(/\D/g, "")), street: textOrNull(value.street),
    addressNumber: textOrNull(value.addressNumber), addressComplement: textOrNull(value.addressComplement),
    district: textOrNull(value.district), city: textOrNull(value.city),
    state: /^[A-Z]{2}$/.test(uf) ? uf : null, notes: textOrNull(value.notes),
  });
}
function serviceCommand(raw: Record<string, unknown>) {
  const value = sanitizeHermesPayload(raw, { name: "text", code: "text", category: "text", description: "text", price: "number", defaultPrice: "number", estimatedCost: "number" });
  const rawPrice = value.defaultPrice !== undefined ? value.defaultPrice : value.price;
  const price = Number(rawPrice ?? 0);
  return serviceInput.parse({ name: required(value, "name"), code: textOrNull(value.code), category: textOrNull(value.category), price: Number.isFinite(price) && price >= 0 ? price : 0, estimatedCost: Number(value.estimatedCost) || 0, description: textOrNull(value.description), isActive: true });
}
export async function executeHermesErpAction(input: { tenantId: string; userId: string; userName: string; role: OperationalRole; action: HermesErpAction }): Promise<{ success: true; message: string; entityId: string | number }> {
  try {
    return await runHermesErpAction(input);
  } catch (error) {
    throw new Error(formatHermesError(error));
  }
}
async function runHermesErpAction(input: { tenantId: string; userId: string; userName: string; role: OperationalRole; action: HermesErpAction }): Promise<{ success: true; message: string; entityId: string | number }> {
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
  if (input.action.actionType === "CREATE_SERVICE") {
    const service = await services.create(identity, serviceCommand(args));
    return { success: true, message: "Serviço criado com sucesso.", entityId: service.id };
  }
  if (input.action.actionType === "CREATE_SUPPLIER") {
    const supplier = await suppliers.create(identity, supplierCommand(args));
    return { success: true, message: "Fornecedor criado com sucesso.", entityId: supplier.publicId };
  }
  if (input.action.actionType === "UPDATE_SUPPLIER") {
    let supplierId = typeof args.supplierId === "string" ? args.supplierId.trim() : "";
    if (!supplierId && args.name) {
      const searchRes = await suppliers.list(identity, {
        search: String(args.name).trim(),
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 10,
        state: undefined,
      });
      const found = searchRes.items.find(s =>
        s.legalName.toLowerCase().includes(String(args.name).trim().toLowerCase()) ||
        (s.tradeName && s.tradeName.toLowerCase().includes(String(args.name).trim().toLowerCase()))
      ) || searchRes.items[0];
      if (found) {
        supplierId = found.publicId;
      }
    }
    if (!supplierId) {
      throw new Error(`Fornecedor '${args.name || ""}' não localizado para atualização.`);
    }
    const current = await suppliers.detail(identity, supplierId);
    const rawFields = (args.fieldsToUpdate && typeof args.fieldsToUpdate === "object" && !Array.isArray(args.fieldsToUpdate))
      ? args.fieldsToUpdate as Record<string, unknown>
      : {};
    const fields = { ...args, ...rawFields };
    delete fields.fieldsToUpdate;
    delete fields.supplierId;

    const merged: Record<string, unknown> = {
      name: fields.name ?? fields.legalName ?? current.legalName,
      tradeName: fields.tradeName ?? current.tradeName,
      document: fields.document ?? fields.taxId ?? current.taxId,
      stateRegistration: fields.stateRegistration ?? current.stateRegistration,
      email: fields.email ?? current.email,
      phone: fields.phone ?? current.phone,
      contactName: fields.contactName ?? current.contactName,
      postalCode: fields.postalCode ?? current.postalCode,
      street: fields.street ?? current.street,
      addressNumber: fields.addressNumber ?? current.addressNumber,
      addressComplement: fields.addressComplement ?? current.addressComplement,
      district: fields.district ?? current.district,
      city: fields.city ?? current.city,
      state: fields.state ?? current.state,
      notes: fields.notes ?? current.notes,
    };

    const updatePayload = supplierCommand(merged);
    const supplier = await suppliers.update(identity, current.publicId, updatePayload);
    return { success: true, message: `Fornecedor '${supplier.legalName}' atualizado com sucesso.`, entityId: supplier.publicId };
  }
  if (input.action.actionType === "REQUEST_PURCHASE") {
    let supplierId = typeof args.supplierId === "string" ? args.supplierId.trim() : "";
    const supplierName = typeof args.supplierName === "string" ? args.supplierName.trim() : "";
    if (!supplierId && supplierName) {
      const searchRes = await suppliers.list(identity, {
        search: supplierName,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 10,
        state: undefined,
      });
      const found = searchRes.items.find(s =>
        s.legalName.toLowerCase().includes(supplierName.toLowerCase()) ||
        (s.tradeName && s.tradeName.toLowerCase().includes(supplierName.toLowerCase()))
      ) || searchRes.items[0];
      if (found) {
        supplierId = found.publicId;
      }
    }
    if (!supplierId) {
      throw new Error(`Fornecedor '${supplierName || ""}' não localizado para o pedido de compra.`);
    }

    const rawItems = Array.isArray(args.items) ? args.items as Array<Record<string, unknown>> : [];
    if (!rawItems.length) throw new Error("Informe os itens do pedido de compra.");

    const resolvedItems = await Promise.all(rawItems.map(async item => {
      let productPublicId = typeof item.productId === "string" ? item.productId.trim() : "";
      const productName = typeof item.productName === "string" ? item.productName.trim() : "";
      if (!productPublicId && productName) {
        const foundProds = await products.listProducts(identity, {
          search: productName,
          stock: "all",
          sort: "name",
          direction: "asc",
          page: 1,
          pageSize: 5,
        });
        const matched = foundProds.items.find(p => p.name.toLowerCase() === productName.toLowerCase()) || foundProds.items[0];
        if (matched) {
          productPublicId = matched.publicId;
        } else {
          const created = await products.createProduct(identity, {
            name: productName,
            sku: `PRD-${randomUUID().slice(0, 8).toUpperCase()}`,
            category: "Insumos",
            unit: "unit",
            costPriceCents: cents(item.targetCost ?? 0, "custo"),
            salePriceCents: 0,
            minimumStock: "0.000",
            description: null,
            barcode: null,
          });
          productPublicId = created.publicId;
        }
      }
      if (!productPublicId) throw new Error("Informe o produto ou nome do item para o pedido de compra.");
      const qty = Number(item.quantity ?? 1);
      return {
        productPublicId,
        inventoryItemPublicId: null,
        quantity: String(Number.isFinite(qty) && qty > 0 ? qty : 1),
        unitCostCents: cents(item.targetCost ?? 0, "custo"),
        discountCents: 0,
      };
    }));

    const order = await purchases.create(identity, purchaseDraftInput.parse({
      supplierPublicId: supplierId,
      responsibleUserId: input.userId,
      notes: typeof args.notes === "string" ? args.notes : null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      idempotencyKey: randomUUID(),
      items: resolvedItems,
    }));
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
