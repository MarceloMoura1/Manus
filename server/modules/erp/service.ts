import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { runPostCommitBestEffort } from "../../_core/post-commit";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";
import { canWriteErp, millisQuantity, normalizeBarcode, normalizeQuantity, normalizeSku, quantityMillis, type OperationalRole } from "./contracts";
import { ErpDomainError } from "./errors";
import { ErpRepository, type MovementRow, type ProductListOptions, type ProductRow } from "./repository";

type ProductCommand = { name: string; sku: string; barcode: string | null; description: string | null; category: string | null; unit: "unit" | "kg" | "liter" | "meter"; costPriceCents: number; salePriceCents: number; minimumStock: string };
type MovementCommand = { productPublicId: string; type: "initial" | "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out"; quantity: string; reason: string; idempotencyKey: string };
type Identity = { clientId: string; userId: string; role: OperationalRole };
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
function publicProduct(row: ProductRow) { return { publicId: row.public_id, name: row.name, sku: row.sku, barcode: row.barcode, description: row.description, category: row.category, unit: row.unit, costPriceCents: Number(row.cost_price_cents), salePriceCents: Number(row.sale_price_cents), minimumStock: row.minimum_stock, active: row.active === 1, hasImage: row.primary_media_id !== null, quantity: row.quantity, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publicMovement(row: MovementRow) { return { publicId: row.public_id, productPublicId: row.product_public_id, productName: row.product_name, sku: row.sku, type: row.type, direction: row.direction, quantity: row.quantity, previousBalance: row.previous_balance, resultingBalance: row.resulting_balance, reason: row.reason, referenceType: row.reference_type, referenceId: row.reference_id, createdBy: row.created_by, createdAt: row.created_at, reversed: row.reversed === 1, reversalPublicId: row.reversal_public_id ?? null }; }

export class ErpService {
  constructor(private readonly repository = new ErpRepository(), private readonly wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), private readonly publisher: ErpEventPublisher = socketPublisher) {}
  private assertWrite(identity: Identity) { if (!canWriteErp(identity.role)) throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar o ERP."); }
  private async publish(clientId: string, event: "erp:product.changed" | "erp:stock.changed", payload: ErpEvent) { await runPostCommitBestEffort([() => this.publisher.publish(clientId, event, payload)]); }

  async listProducts(identity: Identity, options: ProductListOptions) { const result = await this.repository.listProducts(identity.clientId, options); return { ...result, items: result.items.map(publicProduct), page: options.page, pageSize: options.pageSize, totalPages: Math.ceil(result.total / options.pageSize), canWrite: canWriteErp(identity.role) }; }
  async getProduct(identity: Identity, publicId: string) { const row = await this.repository.findProduct(identity.clientId, publicId); if (!row) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado."); return publicProduct(row); }
  async createProduct(identity: Identity, command: ProductCommand) {
    this.assertWrite(identity);
    try {
      const row = await this.repository.createProduct(identity.clientId, identity.userId, randomUUID(), normalizedProduct(command));
      if (!row) throw new Error("Product insert unavailable");
      const product = publicProduct(row);
      await this.publish(identity.clientId, "erp:product.changed", { productPublicId: product.publicId, operation: "created", occurredAt: new Date().toISOString() });
      return product;
    } catch (error) { if (dbCode(error) === "ER_DUP_ENTRY") throw new ErpDomainError("CONFLICT", "SKU ou código de barras já cadastrado neste tenant."); throw error; }
  }
  async updateProduct(identity: Identity, publicId: string, command: ProductCommand) {
    this.assertWrite(identity);
    try {
      const row = await this.repository.updateProduct(identity.clientId, publicId, identity.userId, normalizedProduct(command));
      if (!row) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
      const product = publicProduct(row);
      await this.publish(identity.clientId, "erp:product.changed", { productPublicId: publicId, operation: "updated", occurredAt: new Date().toISOString() });
      return product;
    } catch (error) { if (dbCode(error) === "ER_DUP_ENTRY") throw new ErpDomainError("CONFLICT", "SKU ou código de barras já cadastrado neste tenant."); throw error; }
  }
  async setProductActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    if (!await this.repository.setProductActive(identity.clientId, publicId, identity.userId, active)) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
    await this.publish(identity.clientId, "erp:product.changed", { productPublicId: publicId, operation: active ? "activated" : "deactivated", occurredAt: new Date().toISOString() });
    return { ok: true };
  }
  async summary(identity: Identity) {
    const result = await this.repository.summary(identity.clientId); const metrics = result.metrics;
    return { metrics: { activeProducts: Number(metrics?.activeProducts ?? 0), inactiveProducts: Number(metrics?.inactiveProducts ?? 0), lowProducts: Number(metrics?.lowProducts ?? 0), emptyProducts: Number(metrics?.emptyProducts ?? 0), totalQuantity: String(metrics?.totalQuantity ?? "0.000"), costValueCents: Number(metrics?.costValueCents ?? 0), saleValueCents: Number(metrics?.saleValueCents ?? 0) }, critical: result.critical.map(publicProduct), recent: result.recent.map(publicMovement), canWrite: canWriteErp(identity.role) };
  }
  async listMovements(identity: Identity, filters: { productPublicId?: string; type?: string; search: string; from?: string; to?: string; page: number; pageSize: number }) {
    const result = await this.repository.listMovements(identity.clientId, filters);
    return { ...result, items: result.items.map(publicMovement), page: filters.page, pageSize: filters.pageSize, totalPages: Math.ceil(result.total / filters.pageSize), canWrite: canWriteErp(identity.role) };
  }

  async moveStock(identity: Identity, command: MovementCommand) {
    this.assertWrite(identity);
    if (quantityMillis(command.quantity) <= 0n) throw new ErpDomainError("VALIDATION", "A quantidade deve ser positiva.");
    const normalized = { ...command, quantity: normalizeQuantity(command.quantity), reason: command.reason.trim() };
    const payloadHash = createHash("sha256").update(JSON.stringify({ productPublicId: command.productPublicId, type: command.type, quantity: normalized.quantity, reason: normalized.reason })).digest("hex");
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
      await connection.execute("INSERT IGNORE INTO erp_stock_balances (client_id,product_id,quantity,version) VALUES (?,?,0,0)", [identity.clientId, product.id]);
      const [balanceRows] = await connection.execute<RowDataPacket[]>("SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE", [identity.clientId, product.id]);
      const previous = quantityMillis(String(balanceRows[0]?.quantity ?? "0"));
      const direction = command.type === "manual_out" || command.type === "adjustment_out" ? "out" : "in";
      const resulting = quantityMillis(projectStockBalance(millisQuantity(previous), command.quantity, direction));
      const publicId = randomUUID();
      await connection.execute("INSERT INTO erp_stock_movements (public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,idempotency_key,payload_hash,created_by) VALUES (?,?,?,?,?,?,?,?,?,'manual',?,?,?)", [publicId, identity.clientId, product.id, command.type, direction, command.quantity, millisQuantity(previous), millisQuantity(resulting), command.reason, command.idempotencyKey, payloadHash, identity.userId]);
      await connection.execute("UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?", [millisQuantity(resulting), identity.clientId, product.id]);
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
        const [originalRows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.client_id=? AND m.public_id=? FOR UPDATE", [identity.clientId, movementPublicId]);
        const original = originalRows[0];
        if (!original) throw new ErpDomainError("NOT_FOUND", "Movimentação não encontrada.");
        if (original.type === "reversal") throw new ErpDomainError("VALIDATION", "Um estorno não pode ser estornado.");
        if (original.type === "purchase_in") throw new ErpDomainError("CONFLICT", "Recebimentos de compra não podem ser revertidos isoladamente.");
        if (original.type === "sale_out") throw new ErpDomainError("CONFLICT", "Baixas de venda não podem ser revertidas isoladamente.");
        const [existing] = await connection.execute<RowDataPacket[]>("SELECT id FROM erp_stock_movements WHERE client_id=? AND reversal_of=? LIMIT 1", [identity.clientId, original.id]);
        if (existing.length) throw new ErpDomainError("ALREADY_REVERSED", "Movimentação já estornada.");
        const [balanceRows] = await connection.execute<RowDataPacket[]>("SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE", [identity.clientId, original.product_id]);
        const previous = quantityMillis(String(balanceRows[0]?.quantity ?? "0")); const amount = quantityMillis(original.quantity); const direction = original.direction === "in" ? "out" : "in"; const resulting = direction === "in" ? previous + amount : previous - amount;
        if (resulting < 0n) throw new ErpDomainError("INSUFFICIENT_STOCK", "O saldo atual não permite este estorno.");
        const publicId = randomUUID();
        await connection.execute("INSERT INTO erp_stock_movements (public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,reversal_of,created_by) VALUES (?,?,?,?,?,?,?,?,?,'movement',?,?,?,?,?)", [publicId, identity.clientId, original.product_id, "reversal", direction, original.quantity, millisQuantity(previous), millisQuantity(resulting), reason.trim(), movementPublicId, idempotencyKey, payloadHash, original.id, identity.userId]);
        await connection.execute("UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?", [millisQuantity(resulting), identity.clientId, original.product_id]);
        const movement = await this.findByPublicId(connection, identity.clientId, publicId);
        if (!movement) throw new Error("Pending reversal unavailable");
        await connection.commit();
        return { movement: publicMovement(movement), changed: true };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    });
    if (outcome.changed) await this.publish(identity.clientId, "erp:stock.changed", { productPublicId: outcome.movement.productPublicId, movementPublicId: outcome.movement.publicId, operation: "movement_reversed", occurredAt: new Date().toISOString() });
    return outcome.movement;
  }

  private async findIdempotent(connection: PoolConnection, clientId: string, key: string): Promise<MovementRow | null> { const [rows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.client_id=? AND m.idempotency_key=? LIMIT 1 FOR UPDATE", [clientId, key]); return rows[0] ?? null; }
  private async findByPublicId(connection: PoolConnection, clientId: string, publicId: string): Promise<MovementRow | null> { const [rows] = await connection.execute<MovementRow[]>("SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.client_id=? AND m.public_id=? LIMIT 1", [clientId, publicId]); return rows[0] ?? null; }
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error) { if (!isRetryableStockError(error) || attempt === 2) throw error; await this.wait(20 * (attempt + 1)); } } throw new Error("Unreachable retry state"); }
}
