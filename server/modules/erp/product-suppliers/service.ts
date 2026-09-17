import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import { ErpRepository } from "../repository";
import { SupplierRepository } from "../suppliers/repository";
import {
  canWriteProductSuppliers,
  normalizeSupplierProductCode,
  type ProductSupplierInput,
  type ProductSupplierListInput,
  type ProductSupplierUpdateInput,
} from "./contracts";
import {
  ProductSupplierRepository,
  type ProductSupplierRow,
} from "./repository";

type Identity = { clientId: string; userId: string; role: OperationalRole };

export type ProductSupplierOperation =
  | "created"
  | "updated"
  | "deleted"
  | "preferred_changed"
  | "activated"
  | "deactivated";

export type ProductSupplierEvent = {
  publicId: string;
  productPublicId: string;
  supplierPublicId: string;
  operation: ProductSupplierOperation;
  occurredAt: string;
};

export type ProductSupplierEventPublisher = {
  publish(
    clientId: string,
    event: "erp:product_supplier.changed",
    payload: ProductSupplierEvent
  ): void | Promise<void>;
};

const socketPublisher: ProductSupplierEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export function productSupplierPublic(row: ProductSupplierRow) {
  return {
    publicId: row.public_id,
    productPublicId: row.product_public_id,
    productName: row.product_name,
    productSku: row.product_sku,
    supplierPublicId: row.supplier_public_id,
    supplierLegalName: row.supplier_legal_name,
    supplierTradeName: row.supplier_trade_name,
    supplierProductCode: row.supplier_product_code,
    costPriceCents:
      row.cost_price_cents !== null && row.cost_price_cents !== undefined
        ? Number(row.cost_price_cents)
        : null,
    isPreferred: row.is_preferred === 1,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export class ProductSupplierService {
  constructor(
    private readonly repository = new ProductSupplierRepository(),
    private readonly productRepository = new ErpRepository(),
    private readonly supplierRepository = new SupplierRepository(),
    private readonly publisher: ProductSupplierEventPublisher = socketPublisher
  ) {}

  private assertWrite(identity: Identity) {
    if (!canWriteProductSuppliers(identity.role)) {
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite alterar associações de produto e fornecedor."
      );
    }
  }

  private async publish(
    clientId: string,
    publicId: string,
    productPublicId: string,
    supplierPublicId: string,
    operation: ProductSupplierOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:product_supplier.changed", {
          publicId,
          productPublicId,
          supplierPublicId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  async list(identity: Identity, options: ProductSupplierListInput) {
    const result = await this.repository.list(identity.clientId, options);
    return {
      items: result.items.map(productSupplierPublic),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteProductSuppliers(identity.role),
    };
  }

  async detail(identity: Identity, publicId: string) {
    const row = await this.repository.find(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }
    return productSupplierPublic(row);
  }

  async create(identity: Identity, input: ProductSupplierInput) {
    this.assertWrite(identity);

    // 1. Verify product exists in tenant
    const product = await this.productRepository.findProduct(
      identity.clientId,
      input.productPublicId
    );
    if (!product) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Produto não encontrado neste tenant."
      );
    }

    // 2. Verify supplier exists in tenant
    const supplier = await this.supplierRepository.find(
      identity.clientId,
      input.supplierPublicId
    );
    if (!supplier) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Fornecedor não encontrado neste tenant."
      );
    }

    // 3. Check for existing association
    const existing = await this.repository.findByProductAndSupplier(
      identity.clientId,
      product.id,
      supplier.id
    );
    if (existing) {
      throw new ErpDomainError(
        "CONFLICT",
        "Fornecedor já associado a este produto neste tenant."
      );
    }

    const publicId = randomUUID();
    const normalizedCode = normalizeSupplierProductCode(
      input.supplierProductCode
    );

    if (input.isPreferred && input.active === false) {
      throw new ErpDomainError(
        "VALIDATION",
        "Um fornecedor inativo não pode ser marcado como preferencial."
      );
    }

    const connection = await this.repository.getPool().getConnection();
    try {
      await connection.beginTransaction();

      // If marked as preferred, acquire parent product lock and clear other preferred suppliers for this product
      if (input.isPreferred) {
        await this.repository.lockProductRow(
          identity.clientId,
          product.id,
          connection
        );
        await this.repository.clearPreferredForProduct(
          identity.clientId,
          product.id,
          undefined,
          connection
        );
      }

      const row = await this.repository.create(
        identity.clientId,
        identity.userId,
        publicId,
        product.id,
        supplier.id,
        {
          supplierProductCode: normalizedCode,
          costPriceCents: input.costPriceCents,
          isPreferred: input.isPreferred,
          active: input.active,
        },
        connection
      );

      await connection.commit();

      await this.publish(
        identity.clientId,
        publicId,
        product.public_id,
        supplier.public_id,
        "created"
      );

      return productSupplierPublic(row);
    } catch (error) {
      await connection.rollback();
      const code = dbCode(error);
      if (code === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Fornecedor já associado a este produto neste tenant."
        );
      }
      if (
        code === "ER_NO_REFERENCED_ROW" ||
        code === "ER_NO_REFERENCED_ROW_2"
      ) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Produto ou fornecedor inválido ou inexistente neste tenant."
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async update(
    identity: Identity,
    publicId: string,
    input: ProductSupplierUpdateInput
  ) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }

    if (input.isPreferred === true && input.active === false) {
      throw new ErpDomainError(
        "VALIDATION",
        "Um fornecedor inativo não pode ser marcado como preferencial."
      );
    }

    if (
      input.isPreferred === true &&
      current.active === 0 &&
      input.active !== true
    ) {
      throw new ErpDomainError(
        "VALIDATION",
        "Não é possível marcar um fornecedor inativo como preferencial sem reativá-lo."
      );
    }

    const effectiveIsPreferred =
      input.active === false &&
      current.is_preferred === 1 &&
      input.isPreferred === undefined
        ? false
        : input.isPreferred;

    const normalizedCode =
      input.supplierProductCode !== undefined
        ? normalizeSupplierProductCode(input.supplierProductCode)
        : undefined;

    const connection = await this.repository.getPool().getConnection();
    try {
      await connection.beginTransaction();

      if (effectiveIsPreferred === true) {
        await this.repository.lockProductRow(
          identity.clientId,
          current.product_id,
          connection
        );
        await this.repository.clearPreferredForProduct(
          identity.clientId,
          current.product_id,
          current.id,
          connection
        );
      }

      const updated = await this.repository.update(
        identity.clientId,
        publicId,
        identity.userId,
        {
          supplierProductCode: normalizedCode,
          costPriceCents: input.costPriceCents,
          isPreferred: effectiveIsPreferred,
          active: input.active,
        },
        connection
      );

      if (!updated) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Associação produto-fornecedor não encontrada neste tenant."
        );
      }

      await connection.commit();

      await this.publish(
        identity.clientId,
        publicId,
        current.product_public_id,
        current.supplier_public_id,
        "updated"
      );

      return productSupplierPublic(updated);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async setPreferred(
    identity: Identity,
    publicId: string,
    isPreferred: boolean
  ) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }

    if (isPreferred && current.active === 0) {
      throw new ErpDomainError(
        "VALIDATION",
        "Não é possível definir como preferencial um fornecedor inativo."
      );
    }

    const updated = await this.repository.setPreferred(
      identity.clientId,
      publicId,
      identity.userId,
      isPreferred
    );

    if (!updated) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }

    await this.publish(
      identity.clientId,
      publicId,
      current.product_public_id,
      current.supplier_public_id,
      "preferred_changed"
    );

    return productSupplierPublic(updated);
  }

  async delete(identity: Identity, publicId: string) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }

    const deleted = await this.repository.delete(identity.clientId, publicId);
    if (!deleted) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      );
    }

    await this.publish(
      identity.clientId,
      publicId,
      current.product_public_id,
      current.supplier_public_id,
      "deleted"
    );

    return { ok: true };
  }
}
