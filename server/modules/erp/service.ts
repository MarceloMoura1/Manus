import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { runPostCommitBestEffort } from "../../_core/post-commit";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";
import { canWriteErp, millisQuantity, normalizeBarcode, normalizeQuantity, normalizeSku, quantityMillis, type OperationalRole } from "./contracts";
import { ErpDomainError } from "./errors";
import { ErpRepository, type MovementRow, type ProductListOptions, type ProductRow } from "./repository";

import { CategoryRepository } from "./categories/repository";
import { BrandRepository } from "./brands/repository";
import { VariantRepository, type VariantRow, type VariantAttributeValueRow } from "./variants/repository";
import { variantPublic } from "./variants/service";
import { ProductSupplierRepository, type ProductSupplierRow } from "./product-suppliers/repository";
import { productSupplierPublic } from "./product-suppliers/service";
import {
  buildDiff,
  type ProductAuditAction,
} from "./product-audit/contracts";
import { ProductAuditRepository } from "./product-audit/repository";
import { InventoryRepository } from "./inventory/repository";

type ProductCommand = {
  name: string; sku: string; barcode: string | null; description: string | null; category: string | null;
  categoryPublicId?: string | null;
  brandPublicId?: string | null;
  unit: "unit" | "kg" | "liter" | "meter"; costPriceCents: number; salePriceCents: number; minimumStock: string;
};
type MovementCommand = { productPublicId: string; inventoryItemPublicId?: string | null; type: "initial" | "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out"; quantity: string; reason: string; idempotencyKey: string };
type Identity = { clientId: string; userId: string; role: OperationalRole; userName?: string };
type ErpEvent = { productPublicId: string; movementPublicId?: string; operation: "created" | "updated" | "activated" | "deactivated" | "movement_created" | "movement_reversed"; occurredAt: string };
export type ErpEventPublisher = { publish(clientId: string, event: "erp:product.changed" | "erp:stock.changed", payload: ErpEvent): void | Promise<void> };
const socketPublisher: ErpEventPublisher = { publish: (clientId, event, payload) => emitOperationalTenantEvent(clientId, event, payload) };

function dbCode(error: unknown): string | undefined { return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined; }
export function isRetryableStockError(error: unknown): boolean { return ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(dbCode(error) ?? ""); }
export function projectStockBalance(previous: string, quantity: string, direction: "in" | "out"): string {
  const projected = direction === "in" ? quantityMillis(previous) + quantityMillis(quantity) : quantityMillis(previous) - quantityMillis(quantity);
  if (projected < 0n) throw new ErpDomainError("INSUFFICIENT_STOCK", "Estoque insuficiente para concluir a saída.");
  return millisQuantity(projected);
}
function normalizedProduct(input: ProductCommand): ProductCommand { return { ...input, name: input.name.trim().replace(/\s+/g, " "), sku: normalizeSku(input.sku), barcode: normalizeBarcode(input.barcode), description: input.description?.trim() || null, category: input.category?.trim() || null, minimumStock: normalizeQuantity(input.minimumStock) }; }
function publicProduct(row: ProductRow) {
  return {
    publicId: row.public_id, name: row.name, sku: row.sku, barcode: row.barcode, description: row.description,
    category: row.category,
    categoryId: row.category_id ?? null,
    categoryPublicId: row.category_public_id ?? null,
    categoryDetails: row.category_public_id ? { publicId: row.category_public_id, name: row.category_name ?? "" } : null,
    categoryRelational: row.category_public_id ? { publicId: row.category_public_id, name: row.category_name ?? "", slug: row.category_slug ?? "" } : null,
    brandId: row.brand_id ?? null,
    brandPublicId: row.brand_public_id ?? null,
    brandDetails: row.brand_public_id ? { publicId: row.brand_public_id, name: row.brand_name ?? "" } : null,
    brand: row.brand_public_id ? { publicId: row.brand_public_id, name: row.brand_name ?? "", slug: row.brand_slug ?? "" } : null,
    unit: row.unit, costPriceCents: Number(row.cost_price_cents), salePriceCents: Number(row.sale_price_cents), minimumStock: row.minimum_stock, active: row.active === 1, hasImage: row.primary_media_id !== null, quantity: row.quantity, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function publicMovement(row: MovementRow) { return { publicId: row.public_id, productPublicId: row.product_public_id, productName: row.product_name, sku: row.sku, unit: row.unit, inventoryItemPublicId: row.inventory_item_public_id ?? null, inventoryItemKind: row.inventory_item_kind ?? null, type: row.type, direction: row.direction, quantity: row.quantity, previousBalance: row.previous_balance, resultingBalance: row.resulting_balance, inventoryPreviousBalance: row.inventory_previous_balance ?? null, inventoryResultingBalance: row.inventory_resulting_balance ?? null, reason: row.reason, referenceType: row.reference_type, referenceId: row.reference_id, createdBy: row.created_by, responsibleDisplayName: row.responsible_name?.trim() || "Usuário indisponível", createdAt: row.created_at, reversed: row.reversed === 1, reversalPublicId: row.reversal_public_id ?? null }; }

export class ErpService {
  constructor(
    private readonly repository = new ErpRepository(),
    private readonly wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    private readonly publisher: ErpEventPublisher = socketPublisher,
    private readonly categories = new CategoryRepository(),
    private readonly brands = new BrandRepository(),
    private readonly variants = new VariantRepository(),
    private readonly auditRepository = new ProductAuditRepository(),
    private readonly productSuppliers = new ProductSupplierRepository(),
    private readonly inventory = new InventoryRepository()
  ) {}
  private assertWrite(identity: Identity) { if (!canWriteErp(identity.role)) throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar o ERP."); }
  private async publish(clientId: string, event: "erp:product.changed" | "erp:stock.changed", payload: ErpEvent) { await runPostCommitBestEffort([() => this.publisher.publish(clientId, event, payload)]); }

  private async getConnection(): Promise<PoolConnection | null> {
    if (typeof this.repository.getPool === "function") {
      const pool = this.repository.getPool();
      if (pool && typeof pool.getConnection === "function") {
        return await pool.getConnection();
      }
    }
    return null;
  }

  private async resolveCategoryAndBrand(
    clientId: string,
    command: ProductCommand,
    current?: ProductRow
  ): Promise<{ categoryId: number | null; brandId: number | null }> {
    let resolvedCategoryId: number | null = current ? current.category_id : null;
    let resolvedBrandId: number | null = current ? current.brand_id : null;

    if (command.categoryPublicId !== undefined) {
      if (command.categoryPublicId === null) {
        resolvedCategoryId = null;
      } else {
        const cat = await this.categories.find(clientId, command.categoryPublicId);
        if (!cat) throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
        resolvedCategoryId = cat.id;
      }
    }

    if (command.brandPublicId !== undefined) {
      if (command.brandPublicId === null) {
        resolvedBrandId = null;
      } else {
        const br = await this.brands.find(clientId, command.brandPublicId);
        if (!br) throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
        resolvedBrandId = br.id;
      }
    }

    return { categoryId: resolvedCategoryId, brandId: resolvedBrandId };
  }

  async listProducts(identity: Identity, options: ProductListOptions) {
    if (options.categoryPublicId) {
      const cat = await this.categories.find(identity.clientId, options.categoryPublicId);
      if (!cat) {
        return { items: [], total: 0, page: options.page, pageSize: options.pageSize, totalPages: 0, canWrite: canWriteErp(identity.role) };
      }
    }
    if (options.categoryId) {
      const cat = await this.categories.findById(identity.clientId, options.categoryId);
      if (!cat) {
        return { items: [], total: 0, page: options.page, pageSize: options.pageSize, totalPages: 0, canWrite: canWriteErp(identity.role) };
      }
    }
    const result = await this.repository.listProducts(identity.clientId, options);
    return { ...result, items: result.items.map(publicProduct), page: options.page, pageSize: options.pageSize, totalPages: Math.ceil(result.total / options.pageSize), canWrite: canWriteErp(identity.role) };
  }

  private async assembleProduct(identity: Identity, row: ProductRow) {
    const base = publicProduct(row);

    let variantRows: VariantRow[] = [];
    let attributesMap = new Map<number, VariantAttributeValueRow[]>();
    if (typeof this.variants?.findByProductId === "function") {
      try {
        const res = await this.variants.findByProductId(identity.clientId, row.id);
        variantRows = res.rows;
        attributesMap = res.attributesMap;
      } catch {
        variantRows = [];
        attributesMap = new Map();
      }
    }
    const variants = variantRows.map((v) => variantPublic(v, attributesMap.get(v.id) ?? []));

    let preferredSupplierRow: ProductSupplierRow | null = null;
    if (typeof this.productSuppliers?.findPreferredForProduct === "function") {
      try {
        preferredSupplierRow = await this.productSuppliers.findPreferredForProduct(identity.clientId, row.id);
      } catch {
        preferredSupplierRow = null;
      }
    }
    const preferredSupplier =
      preferredSupplierRow &&
      preferredSupplierRow.active === 1 &&
      preferredSupplierRow.is_preferred === 1
        ? productSupplierPublic(preferredSupplierRow)
        : null;

    return {
      ...base,
      variants,
      preferredSupplier,
    };
  }

  async getProduct(identity: Identity, publicId: string) {
    const row = await this.repository.findProduct(identity.clientId, publicId);
    if (!row) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
    return this.assembleProduct(identity, row);
  }

  async getProductBySku(identity: Identity, sku: string) {
    const normalized = normalizeSku(sku);
    let row = await this.repository.findProductBySku(identity.clientId, normalized);
    let matchedVariantPublicId: string | null = null;

    if (!row && typeof this.variants?.findBySku === "function") {
      try {
        const variant = await this.variants.findBySku(identity.clientId, normalized);
        if (variant) {
          matchedVariantPublicId = variant.public_id;
          row = await this.repository.findProduct(identity.clientId, variant.product_public_id);
        }
      } catch {
        row = null;
      }
    }

    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Produto não encontrado para o SKU informado.");
    }

    const assembled = await this.assembleProduct(identity, row);
    return {
      ...assembled,
      matchedVariantPublicId,
    };
  }

  async getProductByBarcode(identity: Identity, barcode: string) {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) {
      throw new ErpDomainError("VALIDATION", "Código de barras inválido.");
    }
    let row = await this.repository.findProductByBarcode(identity.clientId, normalized);
    let matchedVariantPublicId: string | null = null;

    if (!row && typeof this.variants?.findByBarcode === "function") {
      try {
        const variant = await this.variants.findByBarcode(identity.clientId, normalized);
        if (variant) {
          matchedVariantPublicId = variant.public_id;
          row = await this.repository.findProduct(identity.clientId, variant.product_public_id);
        }
      } catch {
        row = null;
      }
    }

    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Produto não encontrado para o código de barras informado.");
    }

    const assembled = await this.assembleProduct(identity, row);
    return {
      ...assembled,
      matchedVariantPublicId,
    };
  }

  async createProduct(identity: Identity, command: ProductCommand) {
    this.assertWrite(identity);
    const normalized = normalizedProduct(command);
    const variantWithSku = await this.variants.findBySku(identity.clientId, normalized.sku);
    if (variantWithSku) {
      throw new ErpDomainError("CONFLICT", "SKU já cadastrado em uma variante deste tenant.");
    }
    const { categoryId, brandId } = await this.resolveCategoryAndBrand(identity.clientId, command);

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const publicId = randomUUID();
      const row = connection
        ? await this.repository.createProduct(
            identity.clientId,
            identity.userId,
            publicId,
            {
              ...normalized,
              categoryId,
              brandId,
            },
            connection
          )
        : await this.repository.createProduct(
            identity.clientId,
            identity.userId,
            publicId,
            {
              ...normalized,
              categoryId,
              brandId,
            }
          );
      if (!row) throw new Error("Product insert unavailable");

      if (connection) {
        await this.inventory.createSimpleForProduct(connection, {
          clientId: identity.clientId,
          productId: row.id,
          minimumStock: row.minimum_stock,
          userId: identity.userId,
        });
      }

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: row.id,
          entityType: "product",
          entityPublicId: row.public_id,
          action: "product_created",
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary: `Produto criado: ${row.name} (${row.sku})`,
          changesJson: {
            name: { before: null, after: row.name },
            sku: { before: null, after: row.sku },
            salePriceCents: { before: null, after: Number(row.sale_price_cents) },
            costPriceCents: { before: null, after: Number(row.cost_price_cents) },
            unit: { before: null, after: row.unit },
            minimumStock: { before: null, after: row.minimum_stock },
            ...(row.category_name || row.category
              ? { category: { before: null, after: row.category_name ?? row.category } }
              : {}),
            ...(row.brand_name
              ? { brand: { before: null, after: row.brand_name } }
              : {}),
          },
          metadataJson: {
            categoryPublicId: row.category_public_id ?? null,
            brandPublicId: row.brand_public_id ?? null,
          },
        },
        connection
      );

      if (connection) await connection.commit();

      const product = publicProduct(row);
      await this.publish(identity.clientId, "erp:product.changed", {
        productPublicId: product.publicId,
        operation: "created",
        occurredAt: new Date().toISOString(),
      });
      return product;
    } catch (error) {
      if (connection) await connection.rollback();
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError("CONFLICT", "SKU ou código de barras já cadastrado neste tenant.");
      }
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async updateProduct(identity: Identity, publicId: string, command: ProductCommand) {
    this.assertWrite(identity);
    const current = await this.repository.findProduct(identity.clientId, publicId);
    if (!current) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
    const normalized = normalizedProduct(command);
    if (normalized.sku !== current.sku) {
      const variantWithSku = await this.variants.findBySku(identity.clientId, normalized.sku);
      if (variantWithSku) {
        throw new ErpDomainError("CONFLICT", "SKU já cadastrado em uma variante deste tenant.");
      }
    }
    const { categoryId, brandId } = await this.resolveCategoryAndBrand(identity.clientId, command, current);

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const row = await this.repository.updateProduct(
        identity.clientId,
        publicId,
        identity.userId,
        {
          ...normalized,
          categoryId,
          brandId,
        },
        connection ?? undefined
      );
      if (!row) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");

      const beforeFields: Record<string, unknown> = {
        name: current.name,
        sku: current.sku,
        barcode: current.barcode,
        description: current.description,
        unit: current.unit,
        costPriceCents: Number(current.cost_price_cents),
        salePriceCents: Number(current.sale_price_cents),
        minimumStock: current.minimum_stock,
        category: current.category_name ?? current.category ?? null,
        brand: current.brand_name ?? null,
      };

      const afterFields: Record<string, unknown> = {
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        description: row.description,
        unit: row.unit,
        costPriceCents: Number(row.cost_price_cents),
        salePriceCents: Number(row.sale_price_cents),
        minimumStock: row.minimum_stock,
        category: row.category_name ?? row.category ?? null,
        brand: row.brand_name ?? null,
      };

      const changes = buildDiff(beforeFields, afterFields);

      let action: ProductAuditAction = "product_updated";
      const changedKeys = Object.keys(changes ?? {});
      if (changedKeys.length === 1 && changedKeys[0] === "category") {
        action = "category_changed";
      } else if (changedKeys.length === 1 && changedKeys[0] === "brand") {
        action = "brand_changed";
      }

      const summary = action === "category_changed"
        ? `Categoria do produto alterada de "${current.category_name ?? current.category ?? "Nenhuma"}" para "${row.category_name ?? row.category ?? "Nenhuma"}"`
        : action === "brand_changed"
        ? `Marca do produto alterada de "${current.brand_name ?? "Nenhuma"}" para "${row.brand_name ?? "Nenhuma"}"`
        : `Produto atualizado: ${row.name}`;

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: row.id,
          entityType: "product",
          entityPublicId: row.public_id,
          action,
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary,
          changesJson: changes,
          metadataJson: {
            categoryId: row.category_id ?? null,
            categoryPublicId: row.category_public_id ?? null,
            brandId: row.brand_id ?? null,
            brandPublicId: row.brand_public_id ?? null,
          },
        },
        connection
      );

      if (connection) await connection.commit();

      const product = publicProduct(row);
      await this.publish(identity.clientId, "erp:product.changed", {
        productPublicId: publicId,
        operation: "updated",
        occurredAt: new Date().toISOString(),
      });
      return product;
    } catch (error) {
      if (connection) await connection.rollback();
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError("CONFLICT", "SKU ou código de barras já cadastrado neste tenant.");
      }
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async setProductActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    const current = await this.repository.findProduct(identity.clientId, publicId);
    if (!current) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const updated = await this.repository.setProductActive(
        identity.clientId,
        publicId,
        identity.userId,
        active,
        connection ?? undefined
      );
      if (!updated) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");

      const action: ProductAuditAction = active ? "product_activated" : "product_deactivated";
      const summary = active
        ? `Produto ativado: ${current.name}`
        : `Produto desativado: ${current.name}`;

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: current.id,
          entityType: "product",
          entityPublicId: current.public_id,
          action,
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary,
          changesJson: {
            active: { before: current.active === 1, after: active },
          },
        },
        connection
      );

      if (connection) await connection.commit();

      await this.publish(identity.clientId, "erp:product.changed", {
        productPublicId: publicId,
        operation: active ? "activated" : "deactivated",
        occurredAt: new Date().toISOString(),
      });
      return { ok: true };
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }
  async summary(identity: Identity) {
    const result = await this.repository.summary(identity.clientId);
    const metrics = result.metrics;
    return {
      metrics: {
        activeProducts: Number(metrics?.activeProducts ?? 0),
        inactiveProducts: Number(metrics?.inactiveProducts ?? 0),
        lowProducts: Number(metrics?.lowProducts ?? 0),
        emptyProducts: Number(metrics?.emptyProducts ?? 0),
        totalQuantity: String(metrics?.totalQuantity ?? "0.000"),
        costValueCents: Number(metrics?.costValueCents ?? 0),
        saleValueCents: Number(metrics?.saleValueCents ?? 0),
        totalVariants: Number(metrics?.totalVariants ?? 0),
        activeVariants: Number(metrics?.activeVariants ?? 0),
        inactiveVariants: Number(metrics?.inactiveVariants ?? 0),
      },
      critical: result.critical.map(publicProduct),
      recent: result.recent.map(publicMovement),
      canWrite: canWriteErp(identity.role),
    };
  }
  async listMovements(identity: Identity, filters: { productPublicId?: string; type?: string; search: string; from?: string; to?: string; page: number; pageSize: number }) {
    const result = await this.repository.listMovements(identity.clientId, filters);
    return { ...result, items: result.items.map(publicMovement), page: filters.page, pageSize: filters.pageSize, totalPages: Math.ceil(result.total / filters.pageSize), canWrite: canWriteErp(identity.role) };
  }

  async moveStock(identity: Identity, command: MovementCommand) {
    this.assertWrite(identity);
    if (quantityMillis(command.quantity) <= 0n) throw new ErpDomainError("VALIDATION", "A quantidade deve ser positiva.");
    const normalized = { ...command, quantity: normalizeQuantity(command.quantity), reason: command.reason.trim() };
    const payloadHash = createHash("sha256").update(JSON.stringify({ productPublicId: command.productPublicId, inventoryItemPublicId: command.inventoryItemPublicId ?? null, type: command.type, quantity: normalized.quantity, reason: normalized.reason })).digest("hex");
    const outcome = await this.withRetry(() => this.moveInTransaction(identity, normalized, payloadHash));
    if (outcome.changed) await this.publish(identity.clientId, "erp:stock.changed", { productPublicId: outcome.movement.productPublicId, movementPublicId: outcome.movement.publicId, operation: "movement_created", occurredAt: new Date().toISOString() });
    return outcome.movement;
  }

  private async moveInTransaction(identity: Identity, command: MovementCommand, payloadHash: string) {
    const connection = await this.repository.getPool().getConnection();
    try {
      await connection.beginTransaction();
      const replay = await this.findIdempotent(connection, identity.clientId, command.idempotencyKey);
      if (replay) { if (replay.payload_hash !== payloadHash) throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Esta operação já foi usada com dados diferentes."); await connection.commit(); return { movement: publicMovement(replay), changed: false }; }
      const product = await this.repository.findProduct(identity.clientId, command.productPublicId, connection, true);
      if (!product) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
      if (product.active !== 1) throw new ErpDomainError("INACTIVE_PRODUCT", "Produto inativo não aceita movimentação manual.");
      const inventoryItem = await this.inventory.resolveForOperation(connection, {
        clientId: identity.clientId,
        productId: product.id,
        requestedPublicId: command.inventoryItemPublicId,
        userId: identity.userId,
        productMinimumStock: product.minimum_stock,
      });
      await connection.execute("INSERT IGNORE INTO erp_stock_balances (client_id,product_id,quantity,version) VALUES (?,?,0,0)", [identity.clientId, product.id]);
      const [balanceRows] = await connection.execute<RowDataPacket[]>("SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE", [identity.clientId, product.id]);
      const previous = quantityMillis(String(balanceRows[0]?.quantity ?? "0"));
      const direction = command.type === "manual_out" || command.type === "adjustment_out" ? "out" : "in";
      const resulting = quantityMillis(projectStockBalance(millisQuantity(previous), command.quantity, direction));
      const inventoryPrevious = quantityMillis(await this.inventory.lockBalance(connection, identity.clientId, inventoryItem.id));
      const inventoryResulting = quantityMillis(projectStockBalance(millisQuantity(inventoryPrevious), command.quantity, direction));
      const publicId = randomUUID();
      await connection.execute("INSERT INTO erp_stock_movements (public_id,client_id,product_id,inventory_item_id,type,direction,quantity,previous_balance,resulting_balance,inventory_previous_balance,inventory_resulting_balance,reason,reference_type,idempotency_key,payload_hash,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?)", [publicId, identity.clientId, product.id, inventoryItem.id, command.type, direction, command.quantity, millisQuantity(previous), millisQuantity(resulting), millisQuantity(inventoryPrevious), millisQuantity(inventoryResulting), command.reason, command.idempotencyKey, payloadHash, identity.userId]);
      await connection.execute("UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?", [millisQuantity(resulting), identity.clientId, product.id]);
      await this.inventory.setBalance(connection, identity.clientId, inventoryItem.id, millisQuantity(inventoryResulting));
      const movement = await this.findByPublicId(connection, identity.clientId, publicId);
      if (!movement) throw new Error("Pending movement unavailable");
      await connection.commit();
      return { movement: publicMovement(movement), changed: true };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async reverseMovement(identity: Identity, movementPublicId: string, reason: string, idempotencyKey: string) {
    this.assertWrite(identity);
    const payloadHash = createHash("sha256").update(JSON.stringify({ movementPublicId, reason: reason.trim() })).digest("hex");
    const outcome = await this.withRetry(async () => {
      const connection = await this.repository.getPool().getConnection();
      try {
        await connection.beginTransaction();
        const replay = await this.findIdempotent(connection, identity.clientId, idempotencyKey);
        if (replay) { if (replay.payload_hash !== payloadHash) throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Esta operação já foi usada com dados diferentes."); await connection.commit(); return { movement: publicMovement(replay), changed: false }; }
        const [originalRows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku,p.unit FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.client_id=? AND m.public_id=? FOR UPDATE", [identity.clientId, movementPublicId]);
        const original = originalRows[0];
        if (!original) throw new ErpDomainError("NOT_FOUND", "Movimentação não encontrada.");
        if (original.type === "reversal") throw new ErpDomainError("VALIDATION", "Um estorno não pode ser estornado.");
        if (original.type === "purchase_in") throw new ErpDomainError("CONFLICT", "Recebimentos de compra não podem ser revertidos isoladamente.");
        if (original.type === "sale_out") throw new ErpDomainError("CONFLICT", "Baixas de venda não podem ser revertidas isoladamente.");
        if (original.inventory_item_id === null) throw new ErpDomainError("CONFLICT", "Movimentação ainda não vinculada a inventory item.");
        const [existing] = await connection.execute<RowDataPacket[]>("SELECT id FROM erp_stock_movements WHERE client_id=? AND reversal_of=? LIMIT 1", [identity.clientId, original.id]);
        if (existing.length) throw new ErpDomainError("ALREADY_REVERSED", "Movimentação já estornada.");
        const [balanceRows] = await connection.execute<RowDataPacket[]>("SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE", [identity.clientId, original.product_id]);
        const previous = quantityMillis(String(balanceRows[0]?.quantity ?? "0")); const amount = quantityMillis(original.quantity); const direction = original.direction === "in" ? "out" : "in"; const resulting = direction === "in" ? previous + amount : previous - amount;
        if (resulting < 0n) throw new ErpDomainError("INSUFFICIENT_STOCK", "O saldo atual não permite este estorno.");
        const inventoryPrevious = quantityMillis(await this.inventory.lockBalance(connection, identity.clientId, original.inventory_item_id));
        const inventoryResulting = direction === "in" ? inventoryPrevious + amount : inventoryPrevious - amount;
        if (inventoryResulting < 0n) throw new ErpDomainError("INSUFFICIENT_STOCK", "O saldo do inventory item não permite este estorno.");
        const publicId = randomUUID();
        await connection.execute("INSERT INTO erp_stock_movements (public_id,client_id,product_id,inventory_item_id,type,direction,quantity,previous_balance,resulting_balance,inventory_previous_balance,inventory_resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,reversal_of,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'movement',?,?,?,?,?)", [publicId, identity.clientId, original.product_id, original.inventory_item_id, "reversal", direction, original.quantity, millisQuantity(previous), millisQuantity(resulting), millisQuantity(inventoryPrevious), millisQuantity(inventoryResulting), reason.trim(), movementPublicId, idempotencyKey, payloadHash, original.id, identity.userId]);
        await connection.execute("UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?", [millisQuantity(resulting), identity.clientId, original.product_id]);
        await this.inventory.setBalance(connection, identity.clientId, original.inventory_item_id, millisQuantity(inventoryResulting));
        const movement = await this.findByPublicId(connection, identity.clientId, publicId);
        if (!movement) throw new Error("Pending reversal unavailable");
        await connection.commit();
        return { movement: publicMovement(movement), changed: true };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    });
    if (outcome.changed) await this.publish(identity.clientId, "erp:stock.changed", { productPublicId: outcome.movement.productPublicId, movementPublicId: outcome.movement.publicId, operation: "movement_reversed", occurredAt: new Date().toISOString() });
    return outcome.movement;
  }

  private async findIdempotent(connection: PoolConnection, clientId: string, key: string): Promise<MovementRow | null> { const [rows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku,p.unit,ii.public_id inventory_item_public_id,ii.kind inventory_item_kind,u.name responsible_name FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id LEFT JOIN erp_inventory_items ii ON ii.client_id=m.client_id AND ii.id=m.inventory_item_id LEFT JOIN megadesk_domain_client_users u ON u.client_id=m.client_id AND u.user_id=m.created_by WHERE m.client_id=? AND m.idempotency_key=? LIMIT 1 FOR UPDATE", [clientId, key]); return rows[0] ?? null; }
  private async findByPublicId(connection: PoolConnection, clientId: string, publicId: string): Promise<MovementRow | null> { const [rows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku,p.unit,ii.public_id inventory_item_public_id,ii.kind inventory_item_kind,u.name responsible_name FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id LEFT JOIN erp_inventory_items ii ON ii.client_id=m.client_id AND ii.id=m.inventory_item_id LEFT JOIN megadesk_domain_client_users u ON u.client_id=m.client_id AND u.user_id=m.created_by WHERE m.client_id=? AND m.public_id=? LIMIT 1", [clientId, publicId]); return rows[0] ?? null; }
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error) { if (!isRetryableStockError(error) || attempt === 2) throw error; await this.wait(20 * (attempt + 1)); } } throw new Error("Unreachable retry state"); }
}
