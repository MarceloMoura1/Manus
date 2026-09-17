import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWriteCategories,
  normalizeCategoryName,
  normalizeSlug,
  type CategoryInput,
  type CategoryListInput,
  type CategoryMoveInput,
  type CategoryUpdateInput,
} from "./contracts";
import { CategoryRepository, type CategoryRow } from "./repository";

type Identity = { clientId: string; userId: string; role: OperationalRole };

export type CategoryOperation =
  | "created"
  | "updated"
  | "moved"
  | "activated"
  | "deactivated"
  | "deleted";

export type CategoryEvent = {
  categoryPublicId: string;
  operation: CategoryOperation;
  occurredAt: string;
};

export type CategoryEventPublisher = {
  publish(
    clientId: string,
    event: "erp:category.changed",
    payload: CategoryEvent
  ): void | Promise<void>;
};

const socketPublisher: CategoryEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export function categoryPublic(row: CategoryRow) {
  return {
    publicId: row.public_id,
    parentPublicId: row.parent_public_id ?? null,
    parentName: row.parent_name ?? null,
    depth: row.depth,
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

export class CategoryService {
  constructor(
    private readonly repository = new CategoryRepository(),
    private readonly publisher: CategoryEventPublisher = socketPublisher
  ) {}

  private assertWrite(identity: Identity) {
    if (!canWriteCategories(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar categorias.");
    }
  }

  private async publish(
    clientId: string,
    categoryPublicId: string,
    operation: CategoryOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:category.changed", {
          categoryPublicId,
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

  async list(identity: Identity, options: CategoryListInput) {
    const result = await this.repository.list(identity.clientId, options);
    return {
      items: result.items.map(categoryPublic),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteCategories(identity.role),
    };
  }

  async detail(identity: Identity, publicId: string) {
    const row = await this.repository.find(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }
    return categoryPublic(row);
  }

  async create(identity: Identity, input: CategoryInput) {
    this.assertWrite(identity);
    const normalizedName = normalizeCategoryName(input.name);

    let parentId: number | null = null;
    let depth = 0;

    if (input.parentPublicId) {
      const parent = await this.repository.find(identity.clientId, input.parentPublicId);
      if (!parent) {
        throw new ErpDomainError("NOT_FOUND", "Categoria pai não encontrada neste tenant.");
      }
      parentId = parent.id;
      depth = parent.depth + 1;

      if (depth > 2) {
        throw new ErpDomainError(
          "VALIDATION",
          "A profundidade máxima de categorias é de 3 níveis (profundidade 2)."
        );
      }

      const existingSibling = await this.repository.findSiblingByName(
        identity.clientId,
        parentId,
        normalizedName
      );
      if (existingSibling) {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma subcategoria com este nome sob a mesma categoria pai."
        );
      }
    } else {
      // Categoria raiz
      const existingRoot = await this.repository.findRootByName(
        identity.clientId,
        normalizedName
      );
      if (existingRoot) {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma categoria raiz com este nome neste tenant."
        );
      }
    }

    const slug = await this.generateUniqueSlug(identity.clientId, normalizedName);
    const publicId = randomUUID();

    try {
      const row = await this.repository.create(identity.clientId, identity.userId, publicId, {
        name: normalizedName,
        slug,
        parentId,
        depth,
        active: input.active ?? true,
      });

      const publicCategory = categoryPublic(row);
      await this.publish(identity.clientId, publicCategory.publicId, "created");
      return publicCategory;
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma categoria com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async update(identity: Identity, publicId: string, input: CategoryUpdateInput) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }

    const updates: { name?: string; slug?: string; active?: boolean } = {};

    if (input.active !== undefined) {
      updates.active = input.active;
    }

    if (input.name !== undefined) {
      const normalizedName = normalizeCategoryName(input.name);
      if (normalizedName !== current.name) {
        if (current.parent_id === null) {
          const existingRoot = await this.repository.findRootByName(
            identity.clientId,
            normalizedName,
            publicId
          );
          if (existingRoot) {
            throw new ErpDomainError(
              "CONFLICT",
              "Já existe uma categoria raiz com este nome neste tenant."
            );
          }
        } else {
          const existingSibling = await this.repository.findSiblingByName(
            identity.clientId,
            current.parent_id,
            normalizedName,
            publicId
          );
          if (existingSibling) {
            throw new ErpDomainError(
              "CONFLICT",
              "Já existe uma subcategoria com este nome sob a mesma categoria pai."
            );
          }
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
      return categoryPublic(current);
    }

    try {
      const updated = await this.repository.update(
        identity.clientId,
        publicId,
        identity.userId,
        updates
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
      }
      const publicCategory = categoryPublic(updated);
      await this.publish(identity.clientId, publicId, "updated");
      return publicCategory;
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma categoria com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async move(identity: Identity, publicId: string, input: CategoryMoveInput) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }

    if (input.parentPublicId === publicId) {
      throw new ErpDomainError("VALIDATION", "Uma categoria não pode ser pai de si mesma.");
    }

    let targetParentId: number | null = null;
    let targetDepth = 0;

    const descendants = await this.repository.getDescendants(
      identity.clientId,
      current.id
    );

    if (input.parentPublicId) {
      const targetParent = await this.repository.find(
        identity.clientId,
        input.parentPublicId
      );
      if (!targetParent) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Categoria pai de destino não encontrada neste tenant."
        );
      }

      // Prevenir ciclo direto e indireto: o parent de destino não pode ser descendente da categoria sendo movida
      const isDescendant = descendants.some(d => d.id === targetParent.id);
      if (isDescendant) {
        throw new ErpDomainError(
          "VALIDATION",
          "Não é permitido mover uma categoria para um de seus próprios descendentes."
        );
      }

      targetParentId = targetParent.id;
      targetDepth = targetParent.depth + 1;

      // Verificar unicidade de irmão no destino
      const existingSibling = await this.repository.findSiblingByName(
        identity.clientId,
        targetParentId,
        current.name,
        publicId
      );
      if (existingSibling) {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma subcategoria com este nome sob a categoria pai de destino."
        );
      }
    } else {
      // Mover para raiz
      targetParentId = null;
      targetDepth = 0;

      const existingRoot = await this.repository.findRootByName(
        identity.clientId,
        current.name,
        publicId
      );
      if (existingRoot) {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe uma categoria raiz com este nome neste tenant."
        );
      }
    }

    // Validar se qualquer descendente excederia profundidade máxima (2)
    const maxDescendantDepth = descendants.reduce(
      (max, d) => Math.max(max, d.depth),
      current.depth
    );
    const relativeDepthSpan = maxDescendantDepth - current.depth;
    const projectedMaxDepth = targetDepth + relativeDepthSpan;

    if (projectedMaxDepth > 2) {
      throw new ErpDomainError(
        "VALIDATION",
        "A movimentação excede a profundidade máxima permitida de 3 níveis (profundidade 2)."
      );
    }

    const deltaDepth = targetDepth - current.depth;
    const descendantIds = descendants.map(d => d.id);

    await this.repository.moveSubtree(
      identity.clientId,
      identity.userId,
      current.id,
      targetParentId,
      targetDepth,
      deltaDepth,
      descendantIds
    );

    const updated = await this.repository.find(identity.clientId, publicId);
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada após movimentação.");
    }

    const publicCategory = categoryPublic(updated);
    await this.publish(identity.clientId, publicId, "moved");
    return publicCategory;
  }

  async setActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }
    const updated = await this.repository.update(
      identity.clientId,
      publicId,
      identity.userId,
      { active }
    );
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }
    await this.publish(identity.clientId, publicId, active ? "activated" : "deactivated");
    return { ok: true };
  }

  async delete(identity: Identity, publicId: string) {
    this.assertWrite(identity);
    const current = await this.repository.find(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
    }

    const childrenCount = await this.repository.countChildren(
      identity.clientId,
      current.id
    );
    if (childrenCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir categoria que possui subcategorias vinculadas."
      );
    }

    const productsCount = await this.repository.countProducts(
      identity.clientId,
      current.id
    );
    if (productsCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir categoria vinculada a produtos."
      );
    }

    try {
      const deleted = await this.repository.delete(identity.clientId, publicId);
      if (!deleted) {
        throw new ErpDomainError("NOT_FOUND", "Categoria não encontrada neste tenant.");
      }

      await this.publish(identity.clientId, publicId, "deleted");
      return { ok: true };
    } catch (error) {
      const code = dbCode(error);
      if (code === "ER_ROW_IS_REFERENCED_2" || code === "ER_ROW_IS_REFERENCED") {
        throw new ErpDomainError(
          "CONFLICT",
          "Não é possível excluir categoria vinculada a produtos ou subcategorias."
        );
      }
      throw error;
    }
  }
}
