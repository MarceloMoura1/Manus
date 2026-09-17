import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import { AttributeService } from "./service";
import type { AttributeTypeRow, AttributeValueRow } from "./repository";

function mockType(overrides: Partial<AttributeTypeRow> = {}): AttributeTypeRow {
  return {
    id: 1,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    name: "Cor",
    slug: "cor",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as AttributeTypeRow;
}

function mockValue(overrides: Partial<AttributeValueRow> = {}): AttributeValueRow {
  return {
    id: 10,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    attribute_type_id: 1,
    type_public_id: crypto.randomUUID(),
    type_name: "Cor",
    type_slug: "cor",
    name: "Preto",
    slug: "preto",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as AttributeValueRow;
}

describe("AttributeService Domain Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };
  const viewerA = { clientId: "tenant-a", userId: "viewer-a", role: "viewer" as const };

  let repo: any;
  let publisher: any;
  let service: AttributeService;

  beforeEach(() => {
    repo = {
      listTypes: vi.fn(),
      findType: vi.fn(),
      findTypeById: vi.fn(),
      findTypeByName: vi.fn().mockResolvedValue(null),
      findTypeBySlug: vi.fn().mockResolvedValue(null),
      createType: vi.fn(),
      updateType: vi.fn(),
      setTypeActive: vi.fn(),
      countValuesForType: vi.fn().mockResolvedValue(0),
      countTypeUsages: vi.fn().mockResolvedValue(0),
      deleteType: vi.fn().mockResolvedValue(true),

      listValues: vi.fn(),
      findValue: vi.fn(),
      findValueById: vi.fn(),
      findValuesByPublicIds: vi.fn().mockResolvedValue([]),
      findValueByName: vi.fn().mockResolvedValue(null),
      findValueBySlug: vi.fn().mockResolvedValue(null),
      createValue: vi.fn(),
      updateValue: vi.fn(),
      setValueActive: vi.fn(),
      countValueUsages: vi.fn().mockResolvedValue(0),
      deleteValue: vi.fn().mockResolvedValue(true),
    };
    publisher = { publish: vi.fn() };
    service = new AttributeService(repo, publisher);
  });

  describe("ATTRIBUTE_TYPE_CREATE & Lifecycle", () => {
    it("creates an attribute type with normalized name and slug", async () => {
      const created = mockType({ name: "Tamanho", slug: "tamanho" });
      repo.createType.mockResolvedValue(created);

      const result = await service.createType(adminA, { name: "  Tamanho  ", active: true });

      expect(repo.findTypeByName).toHaveBeenCalledWith("tenant-a", "Tamanho");
      expect(repo.createType).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        expect.objectContaining({ name: "Tamanho", slug: "tamanho", active: true })
      );
      expect(result.name).toBe("Tamanho");
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:attribute_type.changed",
        expect.objectContaining({ operation: "created" })
      );
    });

    it("rejects duplicate attribute type name in the same tenant", async () => {
      repo.findTypeByName.mockResolvedValue(mockType({ name: "Cor" }));

      await expect(
        service.createType(adminA, { name: "Cor" })
      ).rejects.toThrow(ErpDomainError);

      expect(repo.createType).not.toHaveBeenCalled();
    });

    it("allows same attribute type name in different tenants", async () => {
      repo.createType.mockResolvedValue(mockType({ client_id: "tenant-b", name: "Cor" }));

      const result = await service.createType(adminB, { name: "Cor" });
      expect(result.name).toBe("Cor");
    });

    it("updates attribute type name and regenerates slug", async () => {
      const current = mockType({ id: 2, name: "Material", slug: "material" });
      repo.findType.mockResolvedValue(current);
      repo.updateType.mockResolvedValue({ ...current, name: "Composição", slug: "composicao" });

      const result = await service.updateType(adminA, current.public_id, {
        name: "Composição",
      });

      expect(result.name).toBe("Composição");
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:attribute_type.changed",
        expect.objectContaining({ operation: "updated" })
      );
    });

    it("rejects type update if new name collides in same tenant", async () => {
      const current = mockType({ id: 2, name: "Material", slug: "material" });
      repo.findType.mockResolvedValue(current);
      repo.findTypeByName.mockResolvedValue(mockType({ id: 3, name: "Cor" }));

      await expect(
        service.updateType(adminA, current.public_id, { name: "Cor" })
      ).rejects.toThrow(ErpDomainError);
    });
  });

  describe("ATTRIBUTE_IN_USE_DELETE_REJECTED", () => {
    it("rejects deleting attribute type when it has registered values", async () => {
      const current = mockType({ id: 1 });
      repo.findType.mockResolvedValue(current);
      repo.countValuesForType.mockResolvedValue(3); // 3 values exist

      await expect(
        service.deleteType(adminA, current.public_id)
      ).rejects.toThrow("Não é possível excluir tipo de atributo que possui valores cadastrados.");

      expect(repo.deleteType).not.toHaveBeenCalled();
    });

    it("rejects deleting attribute type when referenced by variants", async () => {
      const current = mockType({ id: 1 });
      repo.findType.mockResolvedValue(current);
      repo.countValuesForType.mockResolvedValue(0);
      repo.countTypeUsages.mockResolvedValue(5); // 5 variants use this type

      await expect(
        service.deleteType(adminA, current.public_id)
      ).rejects.toThrow("Não é possível excluir tipo de atributo em uso por variantes.");

      expect(repo.deleteType).not.toHaveBeenCalled();
    });

    it("deletes attribute type when not in use", async () => {
      const current = mockType({ id: 1 });
      repo.findType.mockResolvedValue(current);
      repo.countValuesForType.mockResolvedValue(0);
      repo.countTypeUsages.mockResolvedValue(0);

      const result = await service.deleteType(adminA, current.public_id);
      expect(result.ok).toBe(true);
      expect(repo.deleteType).toHaveBeenCalledWith("tenant-a", current.public_id);
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:attribute_type.changed",
        expect.objectContaining({ operation: "deleted" })
      );
    });
  });

  describe("ATTRIBUTE_VALUE_CREATE & ATTRIBUTE_VALUE_BELONGS_TO_TYPE", () => {
    it("creates an attribute value belonging to a valid type", async () => {
      const type = mockType({ id: 1, name: "Cor" });
      repo.findType.mockResolvedValue(type);
      const val = mockValue({ name: "Preto", slug: "preto", attribute_type_id: 1 });
      repo.createValue.mockResolvedValue(val);

      const result = await service.createValue(adminA, {
        typePublicId: type.public_id,
        name: "Preto",
        active: true,
      });

      expect(repo.findValueByName).toHaveBeenCalledWith("tenant-a", 1, "Preto");
      expect(result.name).toBe("Preto");
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:attribute_value.changed",
        expect.objectContaining({ operation: "created" })
      );
    });

    it("CROSS_TENANT_ATTRIBUTE_REJECTED: rejects creating value for a type in another tenant", async () => {
      repo.findType.mockResolvedValue(null); // not found in tenant-a

      await expect(
        service.createValue(adminA, {
          typePublicId: crypto.randomUUID(),
          name: "Azul",
        })
      ).rejects.toThrow("Tipo de atributo não encontrado neste tenant.");

      expect(repo.createValue).not.toHaveBeenCalled();
    });

    it("rejects duplicate value name within the same attribute type", async () => {
      const type = mockType({ id: 1 });
      repo.findType.mockResolvedValue(type);
      repo.findValueByName.mockResolvedValue(mockValue({ name: "Preto" }));

      await expect(
        service.createValue(adminA, {
          typePublicId: type.public_id,
          name: "Preto",
        })
      ).rejects.toThrow("Já existe um valor com este nome para este tipo de atributo.");
    });

    it("allows same value name in different attribute types", async () => {
      const typeB = mockType({ id: 2, name: "Material" });
      repo.findType.mockResolvedValue(typeB);
      repo.findValueByName.mockResolvedValue(null);
      repo.createValue.mockResolvedValue(mockValue({ id: 20, name: "Preto", attribute_type_id: 2 }));

      const result = await service.createValue(adminA, {
        typePublicId: typeB.public_id,
        name: "Preto",
      });
      expect(result.name).toBe("Preto");
    });
  });

  describe("ATTRIBUTE_VALUE_IN_USE_DELETE_REJECTED", () => {
    it("rejects deleting value when in use by variants", async () => {
      const current = mockValue({ id: 10 });
      repo.findValue.mockResolvedValue(current);
      repo.countValueUsages.mockResolvedValue(2); // in use

      await expect(
        service.deleteValue(adminA, current.public_id)
      ).rejects.toThrow("Não é possível excluir valor de atributo em uso por variantes.");

      expect(repo.deleteValue).not.toHaveBeenCalled();
    });

    it("deletes value when not in use", async () => {
      const current = mockValue({ id: 10 });
      repo.findValue.mockResolvedValue(current);
      repo.countValueUsages.mockResolvedValue(0);

      const result = await service.deleteValue(adminA, current.public_id);
      expect(result.ok).toBe(true);
      expect(repo.deleteValue).toHaveBeenCalledWith("tenant-a", current.public_id);
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:attribute_value.changed",
        expect.objectContaining({ operation: "deleted" })
      );
    });
  });

  describe("Tenant Isolation and Permissions", () => {
    it("rejects viewers from creating attribute types", async () => {
      await expect(
        service.createType(viewerA, { name: "Cor" })
      ).rejects.toThrow("Seu perfil não permite alterar atributos.");
    });

    it("rejects viewers from creating attribute values", async () => {
      await expect(
        service.createValue(viewerA, { typePublicId: crypto.randomUUID(), name: "Azul" })
      ).rejects.toThrow("Seu perfil não permite alterar atributos.");
    });

    it("CROSS_TENANT: accessing another tenant's attribute value detail returns NOT_FOUND", async () => {
      repo.findValue.mockResolvedValue(null); // isolated query

      await expect(
        service.detailValue(adminA, crypto.randomUUID())
      ).rejects.toThrow("Valor de atributo não encontrado neste tenant.");
    });
  });
});
