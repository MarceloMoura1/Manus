import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import { AttributeRepository } from "../attributes/repository";
import { normalizeSku, type OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import { ErpRepository } from "../repository";
import {
  calculateEffectivePrice,
  canWriteVariants,
  computeCombinationHash,
  type SetVariantAttributesInput,
  type VariantInput,
  type VariantListInput,
  type VariantUpdateInput,
} from "./contracts";
import {
  VariantRepository,
  type VariantAttributeValueRow,
  type VariantRow,
} from "./repository";
import {
  buildDiff,
  type VariantAuditAction,
} from "../product-audit/contracts";
import { ProductAuditRepository } from "../product-audit/repository";

type Identity = { clientId: string; userId: string; role: OperationalRole; userName?: string };

export type VariantOperation =
  | "created"
  | "updated"
  | "activated"
  | "deactivated"
  | "deleted"
  | "attributes_changed";

export type VariantEvent = {
  variantPublicId: string;
  productPublicId: string;
  operation: VariantOperation;
  occurredAt: string;
};

export type VariantEventPublisher = {
  publish(
    clientId: string,
    event: "erp:variant.changed",
    payload: VariantEvent
  ): void | Promise<void>;
};

const socketPublisher: VariantEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export function variantPublic(
  row: VariantRow,
  attributes: VariantAttributeValueRow[] = []
) {
  const salePriceCents =
    row.sale_price_cents !== null && row.sale_price_cents !== undefined
      ? Number(row.sale_price_cents)
      : null;
  const productSalePriceCents = Number(row.product_sale_price_cents ?? 0);
  const effectivePriceCents = calculateEffectivePrice(
    salePriceCents,
    productSalePriceCents
  );

  return {
    publicId: row.public_id,
    productPublicId: row.product_public_id,
    productName: row.product_name,
    sku: row.sku,
    name: row.name,
    salePriceCents,
    productSalePriceCents,
    effectivePriceCents,
    combinationHash: row.combination_hash,
    active: row.active === 1,
    attributes: attributes.map((a) => ({
      typePublicId: a.type_public_id,
      typeName: a.type_name,
      typeSlug: a.type_slug,
      valuePublicId: a.value_public_id,
      valueName: a.value_name,
      valueSlug: a.value_slug,
    })),
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

export class VariantService {
  constructor(
    private readonly repository = new VariantRepository(),
    private readonly productRepository = new ErpRepository(),
    private readonly attributeRepository = new AttributeRepository(),
    private readonly publisher: VariantEventPublisher = socketPublisher,
    private readonly auditRepository = new ProductAuditRepository()
  ) {}

  private assertWrite(identity: Identity) {
    if (!canWriteVariants(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar variantes.");
    }
  }

  private async getConnection(): Promise<PoolConnection | null> {
    if (typeof this.repository.getPool === "function") {
      const pool = this.repository.getPool();
      if (pool && typeof pool.getConnection === "function") {
        return await pool.getConnection();
      }
    }
    return null;
  }

  private async publish(
    clientId: string,
    variantPublicId: string,
    productPublicId: string,
    operation: VariantOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:variant.changed", {
          variantPublicId,
          productPublicId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  async list(identity: Identity, options: VariantListInput) {
    const result = await this.repository.list(identity.clientId, options);
    return {
      items: result.items.map((row) =>
        variantPublic(row, result.attributesMap.get(row.id) ?? [])
      ),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteVariants(identity.role),
    };
  }

  async detail(identity: Identity, publicId: string) {
    const row = await this.repository.find(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
    }
    const attributes = await this.repository.getAttributesForVariant(
      identity.clientId,
      row.id
    );
    return variantPublic(row, attributes);
  }

  async create(identity: Identity, input: VariantInput) {
    this.assertWrite(identity);

    const normalizedSkuVal = normalizeSku(input.sku);
    if (!normalizedSkuVal) {
      throw new ErpDomainError("VALIDATION", "SKU da variante é obrigatório.");
    }

    // 1. Cross-table SKU check: check other variants
    const existingVariant = await this.repository.findBySku(
      identity.clientId,
      normalizedSkuVal
    );
    if (existingVariant) {
      throw new ErpDomainError(
        "CONFLICT",
        "SKU já cadastrado em outra variante deste tenant."
      );
    }

    // 2. Cross-table SKU check: check products
    const existingProduct = await this.productRepository.findProductBySku(
      identity.clientId,
      normalizedSkuVal
    );
    if (existingProduct) {
      throw new ErpDomainError(
        "CONFLICT",
        "SKU já cadastrado em um produto deste tenant."
      );
    }

    // 3. Verify product exists in tenant
    const product = await this.productRepository.findProduct(
      identity.clientId,
      input.productPublicId
    );
    if (!product) {
      throw new ErpDomainError("NOT_FOUND", "Produto não encontrado neste tenant.");
    }

    // 4. Resolve attribute values
    let combinationHash: string | null = null;
    const attributePairs: Array<{ attributeTypeId: number; attributeValueId: number }> = [];

    const valuePublicIds = input.attributeValuePublicIds ?? [];
    if (valuePublicIds.length > 0) {
      const values = await this.attributeRepository.findValuesByPublicIds(
        identity.clientId,
        valuePublicIds
      );

      if (values.length !== valuePublicIds.length) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Um ou mais valores de atributo não foram encontrados neste tenant."
        );
      }

      // Check for duplicate attribute types on the same variant
      const seenTypes = new Set<number>();
      for (const val of values) {
        if (seenTypes.has(val.attribute_type_id)) {
          throw new ErpDomainError(
            "CONFLICT",
            "Não é permitido associar múltiplos valores do mesmo tipo de atributo a uma variante."
          );
        }
        seenTypes.add(val.attribute_type_id);
        attributePairs.push({
          attributeTypeId: val.attribute_type_id,
          attributeValueId: val.id,
        });
      }

      combinationHash = computeCombinationHash(attributePairs);

      // Check for duplicate combination on the same product
      if (combinationHash) {
        const existingCombo = await this.repository.findByCombination(
          identity.clientId,
          product.id,
          combinationHash
        );
        if (existingCombo) {
          throw new ErpDomainError(
            "CONFLICT",
            "Já existe uma variante com esta mesma combinação de atributos para este produto."
          );
        }
      }
    }

    const publicId = randomUUID();
    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const row = await this.repository.create(
        identity.clientId,
        identity.userId,
        publicId,
        product.id,
        {
          sku: normalizedSkuVal,
          name: input.name ?? null,
          salePriceCents: input.salePriceCents ?? null,
          combinationHash,
          active: input.active,
        },
        attributePairs,
        connection ?? undefined
      );

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: product.id,
          entityType: "variant",
          entityPublicId: row.public_id,
          action: "variant_created",
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary: `Variante criada: SKU ${row.sku}${row.name ? ` (${row.name})` : ""}`,
          changesJson: {
            sku: { before: null, after: row.sku },
            name: { before: null, after: row.name ?? null },
            salePriceCents: {
              before: null,
              after:
                row.sale_price_cents !== null && row.sale_price_cents !== undefined
                  ? Number(row.sale_price_cents)
                  : null,
            },
            active: { before: null, after: row.active === 1 },
          },
          metadataJson: {
            combinationHash: row.combination_hash ?? null,
            attributeCount: attributePairs.length,
          },
        },
        connection ?? undefined
      );

      if (connection) await connection.commit();

      const attributes = await this.repository.getAttributesForVariant(
        identity.clientId,
        row.id
      );

      await this.publish(
        identity.clientId,
        publicId,
        product.public_id,
        "created"
      );

      return variantPublic(row, attributes);
    } catch (error) {
      if (connection) await connection.rollback();
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "SKU ou combinação de atributos já cadastrada para este produto."
        );
      }
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async update(
    identity: Identity,
    publicId: string,
    input: VariantUpdateInput
  ) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
    }

    const updates: {
      sku?: string;
      name?: string | null;
      salePriceCents?: number | null;
      active?: boolean;
    } = {};

    if (input.sku !== undefined) {
      const normalizedSkuVal = normalizeSku(input.sku);
      if (!normalizedSkuVal) {
        throw new ErpDomainError("VALIDATION", "SKU da variante é obrigatório.");
      }

      if (normalizedSkuVal !== current.sku) {
        // 1. Check other variants
        const existingVariant = await this.repository.findBySku(
          identity.clientId,
          normalizedSkuVal,
          publicId
        );
        if (existingVariant) {
          throw new ErpDomainError(
            "CONFLICT",
            "SKU já cadastrado em outra variante deste tenant."
          );
        }

        // 2. Check products
        const existingProduct = await this.productRepository.findProductBySku(
          identity.clientId,
          normalizedSkuVal
        );
        if (existingProduct) {
          throw new ErpDomainError(
            "CONFLICT",
            "SKU já cadastrado em um produto deste tenant."
          );
        }

        updates.sku = normalizedSkuVal;
      }
    }

    if (input.name !== undefined) {
      updates.name = input.name;
    }

    if (input.salePriceCents !== undefined) {
      updates.salePriceCents = input.salePriceCents;
    }

    if (input.active !== undefined) {
      updates.active = input.active;
    }

    if (Object.keys(updates).length === 0) {
      const attributes = await this.repository.getAttributesForVariant(
        identity.clientId,
        current.id
      );
      return variantPublic(current, attributes);
    }

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const updated = await this.repository.update(
        identity.clientId,
        publicId,
        identity.userId,
        updates,
        connection ?? undefined
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
      }

      const beforeFields: Record<string, unknown> = {
        sku: current.sku,
        name: current.name ?? null,
        salePriceCents:
          current.sale_price_cents !== null && current.sale_price_cents !== undefined
            ? Number(current.sale_price_cents)
            : null,
        active: current.active === 1,
      };

      const afterFields: Record<string, unknown> = {
        sku: updated.sku,
        name: updated.name ?? null,
        salePriceCents:
          updated.sale_price_cents !== null && updated.sale_price_cents !== undefined
            ? Number(updated.sale_price_cents)
            : null,
        active: updated.active === 1,
      };

      const changes = buildDiff(beforeFields, afterFields);
      const changedKeys = Object.keys(changes ?? {});

      let action: VariantAuditAction = "variant_updated";
      if (changedKeys.length === 1 && changedKeys[0] === "active") {
        action = updated.active === 1 ? "variant_activated" : "variant_deactivated";
      }

      const summary =
        action === "variant_activated"
          ? `Variante ativada: SKU ${updated.sku}`
          : action === "variant_deactivated"
          ? `Variante desativada: SKU ${updated.sku}`
          : `Variante atualizada: SKU ${updated.sku} (${changedKeys.join(", ") || "sem alterações"})`;

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: current.product_id,
          entityType: "variant",
          entityPublicId: updated.public_id,
          action,
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary,
          changesJson: changes,
        },
        connection ?? undefined
      );

      if (connection) await connection.commit();

      const attributes = await this.repository.getAttributesForVariant(
        identity.clientId,
        updated.id
      );

      await this.publish(
        identity.clientId,
        publicId,
        current.product_public_id,
        "updated"
      );

      return variantPublic(updated, attributes);
    } catch (error) {
      if (connection) await connection.rollback();
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "SKU já cadastrado neste tenant."
        );
      }
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async setAttributes(
    identity: Identity,
    publicId: string,
    input: SetVariantAttributesInput
  ) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
    }

    let combinationHash: string | null = null;
    const attributePairs: Array<{ attributeTypeId: number; attributeValueId: number }> = [];

    const valuePublicIds = input.attributeValuePublicIds;
    if (valuePublicIds.length > 0) {
      const values = await this.attributeRepository.findValuesByPublicIds(
        identity.clientId,
        valuePublicIds
      );

      if (values.length !== valuePublicIds.length) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Um ou mais valores de atributo não foram encontrados neste tenant."
        );
      }

      // Check for duplicate attribute types
      const seenTypes = new Set<number>();
      for (const val of values) {
        if (seenTypes.has(val.attribute_type_id)) {
          throw new ErpDomainError(
            "CONFLICT",
            "Não é permitido associar múltiplos valores do mesmo tipo de atributo a uma variante."
          );
        }
        seenTypes.add(val.attribute_type_id);
        attributePairs.push({
          attributeTypeId: val.attribute_type_id,
          attributeValueId: val.id,
        });
      }

      combinationHash = computeCombinationHash(attributePairs);

      if (combinationHash) {
        const existingCombo = await this.repository.findByCombination(
          identity.clientId,
          current.product_id,
          combinationHash,
          publicId
        );
        if (existingCombo) {
          throw new ErpDomainError(
            "CONFLICT",
            "Já existe uma variante com esta mesma combinação de atributos para este produto."
          );
        }
      }
    }

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const updated = await this.repository.setAttributes(
        identity.clientId,
        publicId,
        identity.userId,
        combinationHash,
        attributePairs,
        connection ?? undefined
      );

      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
      }

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: current.product_id,
          entityType: "variant",
          entityPublicId: updated.public_id,
          action: "attribute_combination_changed",
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary: `Combinação de atributos alterada para a variante ${current.sku}`,
          changesJson: {
            combinationHash: {
              before: current.combination_hash,
              after: updated.combination_hash,
            },
          },
          metadataJson: {
            attributeValues: valuePublicIds,
          },
        },
        connection ?? undefined
      );

      if (connection) await connection.commit();

      const attributes = await this.repository.getAttributesForVariant(
        identity.clientId,
        updated.id
      );

      await this.publish(
        identity.clientId,
        publicId,
        current.product_public_id,
        "attributes_changed"
      );

      return variantPublic(updated, attributes);
    } catch (error) {
      if (connection) await connection.rollback();
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Combinação de atributos já cadastrada para este produto."
        );
      }
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async setActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
    }

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const updated = await this.repository.setActive(
        identity.clientId,
        publicId,
        identity.userId,
        active,
        connection ?? undefined
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
      }

      const action: VariantAuditAction = active ? "variant_activated" : "variant_deactivated";
      const summary = active
        ? `Variante ativada: SKU ${current.sku}`
        : `Variante desativada: SKU ${current.sku}`;

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: current.product_id,
          entityType: "variant",
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
        connection ?? undefined
      );

      if (connection) await connection.commit();

      await this.publish(
        identity.clientId,
        publicId,
        current.product_public_id,
        active ? "activated" : "deactivated"
      );

      return { ok: true };
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  async delete(identity: Identity, publicId: string) {
    this.assertWrite(identity);

    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
    }

    const connection = await this.getConnection();
    try {
      if (connection) await connection.beginTransaction();

      const deleted = await this.repository.delete(
        identity.clientId,
        publicId,
        connection ?? undefined
      );
      if (!deleted) {
        throw new ErpDomainError("NOT_FOUND", "Variante não encontrada neste tenant.");
      }

      const actorName = identity.userName?.trim() || identity.userId;

      await this.auditRepository.record(
        {
          clientId: identity.clientId,
          productId: current.product_id,
          entityType: "variant",
          entityPublicId: current.public_id,
          action: "variant_deleted",
          actorUserId: identity.userId,
          actorNameSnapshot: actorName,
          actorRole: identity.role,
          summary: `Variante excluída: SKU ${current.sku}${current.name ? ` (${current.name})` : ""}`,
          changesJson: {
            active: { before: current.active === 1, after: false },
          },
          metadataJson: {
            sku: current.sku,
            name: current.name ?? null,
          },
        },
        connection ?? undefined
      );

      if (connection) await connection.commit();

      await this.publish(
        identity.clientId,
        publicId,
        current.product_public_id,
        "deleted"
      );

      return { ok: true };
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }
}
