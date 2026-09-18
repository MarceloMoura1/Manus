import { ErpDomainError } from "../errors";
import { ErpRepository } from "../repository";
import type { OperationalRole } from "../contracts";
import type {
  ChangesDiff,
  ProductAuditDetailInput,
  ProductAuditListInput,
  PublicProductAuditLog,
} from "./contracts";
import {
  ProductAuditRepository,
  type ProductAuditRow,
} from "./repository";

export type ErpIdentity = {
  clientId: string;
  userId: string;
  role: OperationalRole;
  userName?: string;
};

function parseJsonField<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

const USER_UUID_PATTERN = /^(user-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function productAuditPublic(row: ProductAuditRow): PublicProductAuditLog {
  const snapshot = row.actor_name_snapshot?.trim();
  const isTechnicalId = !snapshot || USER_UUID_PATTERN.test(snapshot) || snapshot === row.actor_user_id;
  const displayName = isTechnicalId
    ? (row.user_name?.trim() || "Usuário não disponível")
    : snapshot;

  return {
    publicId: row.public_id,
    productPublicId: row.product_public_id ?? "",
    entityType: row.entity_type,
    entityPublicId: row.entity_public_id,
    action: row.action,
    actor: {
      userId: row.actor_user_id,
      name: displayName,
      role: row.actor_role,
    },
    summary: row.summary,
    changes: parseJsonField<ChangesDiff>(row.changes_json),
    metadata: parseJsonField<Record<string, unknown>>(row.metadata_json),
    createdAt: row.created_at,
  };
}

export class ProductAuditService {
  constructor(
    private readonly repository = new ProductAuditRepository(),
    private readonly productRepository = new ErpRepository()
  ) {}

  getRepository(): ProductAuditRepository {
    return this.repository;
  }

  async list(identity: ErpIdentity, input: ProductAuditListInput) {
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

    const result = await this.repository.list(
      identity.clientId,
      product.id,
      input
    );

    return {
      items: result.items.map((row) => ({
        ...productAuditPublic(row),
        productPublicId: product.public_id,
      })),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(result.total / input.pageSize),
    };
  }

  async detail(identity: ErpIdentity, input: ProductAuditDetailInput) {
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

    const row = await this.repository.find(
      identity.clientId,
      product.id,
      input.auditPublicId
    );
    if (!row) {
      throw new ErpDomainError(
        "NOT_FOUND",
        "Registro de auditoria não encontrado neste tenant."
      );
    }

    return {
      ...productAuditPublic(row),
      productPublicId: product.public_id,
    };
  }
}
