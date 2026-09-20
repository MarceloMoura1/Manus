import { describe, expect, it } from "vitest";
import { ErpDomainError, erpTrpcCode } from "../errors";
import { canWriteSuppliers, normalizeSupplierInput, supplierEvent, supplierInput, supplierListInput } from "./contracts";

// Known valid documents
const VALID_CNPJ = "04.252.011/0001-10";
const VALID_CPF = "529.982.247-25";

const validPJ = {
  legalName: "  ACME   Brasil LTDA  ",
  tradeName: "ACME Brasil",
  personType: "legal" as const,
  taxId: VALID_CNPJ,
  stateRegistration: "  IE 1 ",
  email: " CONTATO@EXAMPLE.COM ",
  phone: " 11 9999-0000 ",
  contactName: "  Maria   Silva ",
  postalCode: "01.234-567",
  street: " Rua A ",
  addressNumber: " 10 ",
  addressComplement: " ",
  district: " Centro ",
  city: " São Paulo ",
  state: "sp",
  notes: "  observação  ",
};

describe("ERP supplier contracts", () => {
  it("normalizes CPF/CNPJ to digits", () =>
    expect(normalizeSupplierInput(supplierInput.parse(validPJ)).taxId).toBe("04252011000110"));

  it("normalizes email and optional text", () => {
    const item = normalizeSupplierInput(supplierInput.parse(validPJ));
    expect(item.email).toBe("contato@example.com");
    expect(item.tradeName).toBe("ACME Brasil");
    expect(item.contactName).toBe("Maria Silva");
  });

  it("normalizes CEP and UF", () => {
    const item = normalizeSupplierInput(supplierInput.parse(validPJ));
    expect([item.postalCode, item.state]).toEqual(["01234567", "SP"]);
  });

  // Minimum valid PJ
  it("accepts minimum valid PJ (CNPJ, Razão Social, Nome Fantasia, phone only, no address)", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "11988887777",
    });
    expect(res.success).toBe(true);
  });

  it("accepts minimum valid PJ with email only", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      email: "contato@alpha.com",
    });
    expect(res.success).toBe(true);
  });

  // Minimum valid PF
  it("accepts minimum valid PF (CPF, Nome Completo, phone only, no Nome Fantasia, no address)", () => {
    const res = supplierInput.safeParse({
      personType: "individual",
      taxId: VALID_CPF,
      legalName: "Carlos Pereira",
      phone: "11988887777",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.tradeName).toBeNull();
    }
  });

  it("accepts minimum valid PF with email only", () => {
    const res = supplierInput.safeParse({
      personType: "individual",
      taxId: VALID_CPF,
      legalName: "Carlos Pereira",
      email: "carlos@example.com",
    });
    expect(res.success).toBe(true);
  });

  // PF without Nome Fantasia
  it("PF without Nome Fantasia is valid and preserves tradeName as null", () => {
    const parsed = supplierInput.parse({
      personType: "individual",
      taxId: VALID_CPF,
      legalName: "Ana Clara Silva",
      phone: "81999998888",
    });
    expect(parsed.tradeName).toBeNull();
  });

  // PJ requires Nome Fantasia
  it("PJ rejects missing or empty Nome Fantasia with actionable message", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "",
      phone: "11988887777",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.path.includes("tradeName") && i.message === "Informe o nome fantasia.")).toBe(true);
    }
  });

  // Missing CPF/CNPJ
  it("rejects missing CPF/CNPJ", () => {
    const resPJ = supplierInput.safeParse({
      personType: "legal",
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "11988887777",
    });
    expect(resPJ.success).toBe(false);
    if (!resPJ.success) {
      expect(resPJ.error.issues.some(i => i.path.includes("taxId") && i.message === "CNPJ inválido.")).toBe(true);
    }

    const resPF = supplierInput.safeParse({
      personType: "individual",
      legalName: "Carlos Pereira",
      phone: "11988887777",
    });
    expect(resPF.success).toBe(false);
    if (!resPF.success) {
      expect(resPF.error.issues.some(i => i.path.includes("taxId") && i.message === "CPF inválido.")).toBe(true);
    }
  });

  // Malformed CPF/CNPJ
  it("rejects malformed CNPJ with actionable message 'CNPJ inválido.'", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: "12345678000100", // invalid checksum
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "11988887777",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.path.includes("taxId") && i.message === "CNPJ inválido.")).toBe(true);
    }
  });

  it("rejects malformed CPF with actionable message 'CPF inválido.'", () => {
    const res = supplierInput.safeParse({
      personType: "individual",
      taxId: "12345678900", // invalid checksum
      legalName: "Carlos Pereira",
      phone: "11988887777",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.path.includes("taxId") && i.message === "CPF inválido.")).toBe(true);
    }
  });

  // No contact channel
  it("rejects when neither phone nor email is provided", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "",
      email: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message === "Informe pelo menos um telefone ou e-mail.")).toBe(true);
    }
  });

  // Malformed email
  it("rejects invalid email with actionable message 'E-mail inválido.'", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "11988887777",
      email: "not-an-email",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.path.includes("email") && i.message === "E-mail inválido.")).toBe(true);
    }
  });

  // Optional address completely absent
  it("allows address to be completely absent", () => {
    const res = supplierInput.safeParse({
      personType: "legal",
      taxId: VALID_CNPJ,
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha",
      phone: "11988887777",
      street: undefined,
      addressNumber: undefined,
      addressComplement: undefined,
      district: undefined,
      city: undefined,
      state: undefined,
      postalCode: undefined,
    });
    expect(res.success).toBe(true);
  });

  it("rejects an invalid UF", () =>
    expect(supplierInput.safeParse({ ...validPJ, state: "São Paulo" }).success).toBe(false));

  it("rejects invalid CEP length", () => {
    const res = supplierInput.safeParse({ ...validPJ, postalCode: "1234" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.path.includes("postalCode") && i.message === "CEP deve conter 8 dígitos.")).toBe(true);
    }
  });

  it("defaults safe pagination and ordering", () =>
    expect(supplierListInput.parse({})).toMatchObject({ sort: "legalName", direction: "asc", page: 1, pageSize: 20 }));

  it("accepts the supported filters", () =>
    expect(supplierListInput.parse({ search: "acme", active: true, city: "Recife", state: "pe" })).toMatchObject({
      search: "acme",
      active: true,
      city: "Recife",
      state: "PE",
    }));

  it.each(["name", "taxId", "DROP TABLE", "id"])(
    "rejects ordering outside the allowlist: %s",
    sort => expect(supplierListInput.safeParse({ sort }).success).toBe(false)
  );

  it.each(["admin", "manager"] as const)("allows %s to write", role => expect(canWriteSuppliers(role)).toBe(true));
  it.each(["agent", "viewer"] as const)("keeps %s read-only", role => expect(canWriteSuppliers(role)).toBe(false));

  it("uses a minimal realtime payload", () => {
    const payload = supplierEvent(crypto.randomUUID(), "updated", "2026-01-01T00:00:00.000Z");
    expect(Object.keys(payload).sort()).toEqual(["occurredAt", "operation", "publicId"]);
    expect(JSON.stringify(payload)).not.toMatch(/client|tax|email|phone|address|notes/i);
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["FORBIDDEN", "FORBIDDEN"],
    ["CONFLICT", "CONFLICT"],
    ["VALIDATION", "BAD_REQUEST"],
  ] as const)("translates %s consistently", (domain, trpc) =>
    expect(erpTrpcCode(new ErpDomainError(domain, "public"))).toBe(trpc)
  );
});
