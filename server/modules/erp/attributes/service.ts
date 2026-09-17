import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWriteAttributes,
  normalizeAttributeName,
  normalizeSlug,
  type AttributeTypeInput,
  type AttributeTypeListInput,
  type AttributeTypeUpdateInput,
  type AttributeValueInput,
  type AttributeValueListInput,
  type AttributeValueUpdateInput,
} from "./contracts";
import {
  AttributeRepository,
  type AttributeTypeRow,
  type AttributeValueRow,
} from "./repository";

type Identity = { clientId: string; userId: string; role: OperationalRole };

export type AttributeOperation =
  | "created"
  | "updated"
  | "activated"
  | "deactivated"
  | "deleted";

export type AttributeTypeEvent = {
  typePublicId: string;
  operation: AttributeOperation;
  occurredAt: string;
};

export type AttributeValueEvent = {
  valuePublicId: string;
  operation: AttributeOperation;
  occurredAt: string;
};

export type AttributeEventPublisher = {
  publish(
    clientId: string,
    event: "erp:attribute_type.changed" | "erp:attribute_value.changed",
    payload: AttributeTypeEvent | AttributeValueEvent
  ): void | Promise<void>;
};

const socketPublisher: AttributeEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export function attributeTypePublic(row: AttributeTypeRow) {
  return {
    publicId: row.public_id,
    name: row.name,
    slug: row.slug,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function attributeValuePublic(row: AttributeValueRow) {
  return {
    publicId: row.public_id,
    typePublicId: row.type_public_id,
    typeName: row.type_name,
    typeSlug: row.type_slug,
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

export class AttributeService {
  constructor(
    private readonly repository = new AttributeRepository(),
    private readonly publisher: AttributeEventPublisher = socketPublisher
  ) {}

  private assertWrite(identity: Identity) {
    if (!canWriteAttributes(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite alterar atributos.");
    }
  }

  private async publishType(
    clientId: string,
    typePublicId: string,
    operation: AttributeOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:attribute_type.changed", {
          typePublicId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  private async publishValue(
    clientId: string,
    valuePublicId: string,
    operation: AttributeOperation
  ) {
    await runPostCommitBestEffort([
      () =>
        this.publisher.publish(clientId, "erp:attribute_value.changed", {
          valuePublicId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  // --- Types ---

  private async generateUniqueTypeSlug(
    clientId: string,
    baseName: string,
    excludePublicId?: string
  ): Promise<string> {
    const baseSlug = normalizeSlug(baseName);
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.repository.findTypeBySlug(
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

  async listTypes(identity: Identity, options: AttributeTypeListInput) {
    const result = await this.repository.listTypes(identity.clientId, options);
    return {
      items: result.items.map(attributeTypePublic),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteAttributes(identity.role),
    };
  }

  async detailType(identity: Identity, publicId: string) {
    const row = await this.repository.findType(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }
    return attributeTypePublic(row);
  }

  async createType(identity: Identity, input: AttributeTypeInput) {
    this.assertWrite(identity);
    const normalizedName = normalizeAttributeName(input.name);

    const existing = await this.repository.findTypeByName(
      identity.clientId,
      normalizedName
    );
    if (existing) {
      throw new ErpDomainError(
        "CONFLICT",
        "Já existe um tipo de atributo com este nome neste tenant."
      );
    }

    const slug = await this.generateUniqueTypeSlug(identity.clientId, normalizedName);
    const publicId = randomUUID();

    try {
      const row = await this.repository.createType(
        identity.clientId,
        identity.userId,
        publicId,
        {
          name: normalizedName,
          slug,
          active: input.active,
        }
      );

      await this.publishType(identity.clientId, publicId, "created");
      return attributeTypePublic(row);
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe um tipo de atributo com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async updateType(
    identity: Identity,
    publicId: string,
    input: AttributeTypeUpdateInput
  ) {
    this.assertWrite(identity);
    const current = await this.repository.findType(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }

    const updates: { name?: string; slug?: string; active?: boolean } = {};

    if (input.name !== undefined) {
      const normalizedName = normalizeAttributeName(input.name);
      if (normalizedName !== current.name) {
        const existing = await this.repository.findTypeByName(
          identity.clientId,
          normalizedName,
          publicId
        );
        if (existing) {
          throw new ErpDomainError(
            "CONFLICT",
            "Já existe um tipo de atributo com este nome neste tenant."
          );
        }
        updates.name = normalizedName;
        updates.slug = await this.generateUniqueTypeSlug(
          identity.clientId,
          normalizedName,
          publicId
        );
      }
    }

    if (input.active !== undefined) {
      updates.active = input.active;
    }

    if (Object.keys(updates).length === 0) {
      return attributeTypePublic(current);
    }

    try {
      const updated = await this.repository.updateType(
        identity.clientId,
        publicId,
        identity.userId,
        updates
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
      }

      await this.publishType(identity.clientId, publicId, "updated");
      return attributeTypePublic(updated);
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe um tipo de atributo com este nome ou identificador neste tenant."
        );
      }
      throw error;
    }
  }

  async setTypeActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    const current = await this.repository.findType(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }

    const updated = await this.repository.setTypeActive(
      identity.clientId,
      publicId,
      identity.userId,
      active
    );
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }

    await this.publishType(
      identity.clientId,
      publicId,
      active ? "activated" : "deactivated"
    );
    return { ok: true };
  }

  async deleteType(identity: Identity, publicId: string) {
    this.assertWrite(identity);
    const current = await this.repository.findType(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }

    const valueCount = await this.repository.countValuesForType(
      identity.clientId,
      current.id
    );
    if (valueCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir tipo de atributo que possui valores cadastrados."
      );
    }

    const usageCount = await this.repository.countTypeUsages(
      identity.clientId,
      current.id
    );
    if (usageCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir tipo de atributo em uso por variantes."
      );
    }

    try {
      const deleted = await this.repository.deleteType(identity.clientId, publicId);
      if (!deleted) {
        throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
      }

      await this.publishType(identity.clientId, publicId, "deleted");
      return { ok: true };
    } catch (error) {
      if (dbCode(error) === "ER_ROW_IS_REFERENCED_2") {
        throw new ErpDomainError(
          "CONFLICT",
          "Não é possível excluir tipo de atributo em uso por variantes ou valores."
        );
      }
      throw error;
    }
  }

  // --- Values ---

  private async generateUniqueValueSlug(
    clientId: string,
    typeId: number,
    baseName: string,
    excludePublicId?: string
  ): Promise<string> {
    const baseSlug = normalizeSlug(baseName);
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.repository.findValueBySlug(
        clientId,
        typeId,
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

  async listValues(identity: Identity, options: AttributeValueListInput) {
    const result = await this.repository.listValues(identity.clientId, options);
    return {
      items: result.items.map(attributeValuePublic),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
      canWrite: canWriteAttributes(identity.role),
    };
  }

  async detailValue(identity: Identity, publicId: string) {
    const row = await this.repository.findValue(identity.clientId, publicId);
    if (!row) {
      throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
    }
    return attributeValuePublic(row);
  }

  async createValue(identity: Identity, input: AttributeValueInput) {
    this.assertWrite(identity);
    const parentType = await this.repository.findType(
      identity.clientId,
      input.typePublicId
    );
    if (!parentType) {
      throw new ErpDomainError("NOT_FOUND", "Tipo de atributo não encontrado neste tenant.");
    }

    const normalizedName = normalizeAttributeName(input.name);
    const existing = await this.repository.findValueByName(
      identity.clientId,
      parentType.id,
      normalizedName
    );
    if (existing) {
      throw new ErpDomainError(
        "CONFLICT",
        "Já existe um valor com este nome para este tipo de atributo."
      );
    }

    const slug = await this.generateUniqueValueSlug(
      identity.clientId,
      parentType.id,
      normalizedName
    );
    const publicId = randomUUID();

    try {
      const row = await this.repository.createValue(
        identity.clientId,
        identity.userId,
        publicId,
        parentType.id,
        {
          name: normalizedName,
          slug,
          active: input.active,
        }
      );

      await this.publishValue(identity.clientId, publicId, "created");
      return attributeValuePublic(row);
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe um valor com este nome ou identificador para este tipo de atributo."
        );
      }
      throw error;
    }
  }

  async updateValue(
    identity: Identity,
    publicId: string,
    input: AttributeValueUpdateInput
  ) {
    this.assertWrite(identity);
    const current = await this.repository.findValue(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
    }

    const updates: { name?: string; slug?: string; active?: boolean } = {};

    if (input.name !== undefined) {
      const normalizedName = normalizeAttributeName(input.name);
      if (normalizedName !== current.name) {
        const existing = await this.repository.findValueByName(
          identity.clientId,
          current.attribute_type_id,
          normalizedName,
          publicId
        );
        if (existing) {
          throw new ErpDomainError(
            "CONFLICT",
            "Já existe um valor com este nome para este tipo de atributo."
          );
        }
        updates.name = normalizedName;
        updates.slug = await this.generateUniqueValueSlug(
          identity.clientId,
          current.attribute_type_id,
          normalizedName,
          publicId
        );
      }
    }

    if (input.active !== undefined) {
      updates.active = input.active;
    }

    if (Object.keys(updates).length === 0) {
      return attributeValuePublic(current);
    }

    try {
      const updated = await this.repository.updateValue(
        identity.clientId,
        publicId,
        identity.userId,
        updates
      );
      if (!updated) {
        throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
      }

      await this.publishValue(identity.clientId, publicId, "updated");
      return attributeValuePublic(updated);
    } catch (error) {
      if (dbCode(error) === "ER_DUP_ENTRY") {
        throw new ErpDomainError(
          "CONFLICT",
          "Já existe um valor com este nome ou identificador para este tipo de atributo."
        );
      }
      throw error;
    }
  }

  async setValueActive(identity: Identity, publicId: string, active: boolean) {
    this.assertWrite(identity);
    const current = await this.repository.findValue(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
    }

    const updated = await this.repository.setValueActive(
      identity.clientId,
      publicId,
      identity.userId,
      active
    );
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
    }

    await this.publishValue(
      identity.clientId,
      publicId,
      active ? "activated" : "deactivated"
    );
    return { ok: true };
  }

  async deleteValue(identity: Identity, publicId: string) {
    this.assertWrite(identity);
    const current = await this.repository.findValue(identity.clientId, publicId);
    if (!current) {
      throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
    }

    const usageCount = await this.repository.countValueUsages(
      identity.clientId,
      current.id
    );
    if (usageCount > 0) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível excluir valor de atributo em uso por variantes."
      );
    }

    try {
      const deleted = await this.repository.deleteValue(identity.clientId, publicId);
      if (!deleted) {
        throw new ErpDomainError("NOT_FOUND", "Valor de atributo não encontrado neste tenant.");
      }

      await this.publishValue(identity.clientId, publicId, "deleted");
      return { ok: true };
    } catch (error) {
      if (dbCode(error) === "ER_ROW_IS_REFERENCED_2") {
        throw new ErpDomainError(
          "CONFLICT",
          "Não é possível excluir valor de atributo em uso por variantes."
        );
      }
      throw error;
    }
  }
}
