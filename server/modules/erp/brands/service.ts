import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWriteBrands,
  normalizeBrandName,
  normalizeSlug,
  type BrandInput,
  type BrandListInput,
  type BrandUpdateInput,
} from "./contracts";
import { BrandRepository, type BrandRow } from "./repository";

type Identity = { clientId: string; userId: string; role: OperationalRole };

export type BrandOperation =
  | "created"
  | "updated"
  | "activated"
  | "deactivated"
  | "deleted";

export type BrandEvent = {
  brandPublicId: string;
  operation: BrandOperation;
  occurredAt: string;
};

export type BrandEventPublisher = {
  publish(
    clientId: string,
    event: "erp:brand.changed",
    payload: BrandEvent
  ): void | Promise<void>;
};

const socketPublisher: BrandEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export function brandPublic(row: BrandRow) {
  return {
    publicId: row.public_id,
    name: row.name,
    slug: row.slug,
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

export class BrandService {
  constructor(
    private readonly repository = new BrandRepository(),
    private readonly publisher: BrandEventPublisher = socketPublisher
  ) {}

  private assertWrite(identity: Identity) {
    if (!canWriteBrands(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar marcas.");
    }
  }

  private async publish(
    clientId: string,
    brandPublicId: string,
    operation: BrandOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:brand.changed", {
          brandPublicId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  private async generateUniqueSlug(
    clientId: string,
    baseName: string,
    excludePublicId?: string
  ): Promise<string> {
    const baseSlug = normalizeSlug(baseName);
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.repository.findBySlug(
        clientId,
        candidate,
        excludePublicId
      );
      if (!existing) {
        return candidate;
      }
      counter += 1;
      candidate = `${baseSlug.slice(0, 110)}-${counter}`;
    }
  }

  async list(identity: Identity, options: BrandListInput) {
    const result = await this.repository.list(identity.clientId, options);
    return {
      items: result.items.map(brandPublic),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteBrands(identity.role),
    };
  }

  async detail(identity: Identity, publicId: string) {
    const row = await this.repository.find(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
    }
    return brandPublic(row);
  }

  async create(identity: Identity, input: BrandInput) {
    this.assertWrite(identity);
    const normalizedName = normalizeBrandName(input.name);

    const existing = await this.repository.findByName(identity.clientId, normalizedName);
    if (existing) {
      throw new ErpDomainError(
        "CONFLICT",
        "Já existe uma marca com este nome neste tenant."
      );
    }

    const slug = await this.generateUniqueSlug(identity.clientId, normalizedName);
    const publicId = randomUUID();

    try {
      const row = await this.repository.create(identity.clientId, identity.userId, publicId, {
        name: normalizedName,
        slug,
        active: input.active ?? true,
      });

      const item = brandPublic(row);
      await this.publish(identity.clientId, item.publicId, "created");
      return item;
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma marca com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async update(identity: Identity, publicId: string, input: BrandUpdateInput) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
    }

    const updates: { name?: string; slug?: string; active?: boolean } = {};

    if (input.active !== undefined) {
      updates.active = input.active;
    }

    if (input.name !== undefined) {
      const normalizedName = normalizeBrandName(input.name);
      if (normalizedName !== current.name) {
        const existing = await this.repository.findByName(
          identity.clientId,
          normalizedName,
          publicId
        );
        if (existing) {
          throw new ErpDomainError(
            "CONFLICT",
            "Já existe uma marca com este nome neste tenant."
          );
        }
        updates.name = normalizedName;
        updates.slug = await this.generateUniqueSlug(
          identity.clientId,
          normalizedName,
          publicId
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return brandPublic(current);
    }

    try {
      const updated = await this.repository.update(
        identity.clientId,
        publicId,
        identity.userId,
        updates
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
      }
      const item = brandPublic(updated);
      await this.publish(identity.clientId, publicId, "updated");
      return item;
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma marca com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async setActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
    }
    const updated = await this.repository.update(
      identity.clientId,
      publicId,
      identity.userId,
      { active }
    );
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
    }
    await this.publish(identity.clientId, publicId, active ? "activated" : "deactivated");
    return { ok: true };
  }

  async delete(identity: Identity, publicId: string) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
    }

    const productsCount = await this.repository.countProducts(
      identity.clientId,
      current.id
    );
    if (productsCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir marca vinculada a produtos."
      );
    }

    try {
      const deleted = await this.repository.delete(identity.clientId, publicId);
      if (!deleted) {
        throw new ErpDomainError("NOT_FOUND", "Marca não encontrada neste tenant.");
      }

      await this.publish(identity.clientId, publicId, "deleted");
      return { ok: true };
    } catch (error) {
      const code = dbCode(error);
      if (code === "ER_ROW_IS_REFERENCED_2" || code === "ER_ROW_IS_REFERENCED") {
        throw new ErpDomainError(
          "CONFLICT",
          "Não é possível excluir marca vinculada a produtos."
        );
      }
      throw error;
    }
  }
}
