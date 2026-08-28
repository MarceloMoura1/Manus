import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { customerTypeToCsv, parseCustomerType } from "../shared/crm";
import { isValidCnpj, isValidCpf, suggestCustomerType } from "../shared/br-documents";
import { normalizeContactPhone, sameContactPhone } from "../shared/contact-phone";

describe("migration customer_type", () => {
  const sql = readFileSync(resolve("drizzle/main-migrations/0011_overjoyed_chameleon.sql"), "utf8").trim();

  it("contém somente a coluna CRM anulável e sem default/backfill", () => {
    expect(sql).toBe("ALTER TABLE `megadesk_crm_clients` ADD `customer_type` enum('person','company');");
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE|DELETE|DROP|CREATE TABLE/i);
  });
});

describe("contratos Pessoa/Empresa", () => {
  it.each([["pessoa", "person"], ["person", "person"], ["empresa", "company"], ["company", "company"], ["", null]] as const)("normaliza %s", (input, expected) => {
    expect(parseCustomerType(input)).toBe(expected);
  });

  it("rejeita tipo CSV desconhecido", () => expect(() => parseCustomerType("outro")).toThrow(/inválido/));
  it("exporta aliases portugueses e preserva legado vazio", () => {
    expect([customerTypeToCsv("person"), customerTypeToCsv("company"), customerTypeToCsv(null)]).toEqual(["pessoa", "empresa", ""]);
  });
  it("valida documentos e apenas sugere o legado", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCnpj("04.252.011/0001-10")).toBe(true);
    expect(suggestCustomerType("529.982.247-25")).toBe("person");
    expect(suggestCustomerType("04.252.011/0001-10")).toBe("company");
    expect(suggestCustomerType("123")).toBeNull();
  });
});

describe("normalização compartilhada de contato", () => {
  it("distingue vazio, inválido e válido", () => {
    expect(normalizeContactPhone("").status).toBe("empty");
    expect(normalizeContactPhone("123").status).toBe("invalid");
    expect(normalizeContactPhone("(41) 99548-4515")).toEqual({ status: "valid", value: "5541995484515", country: "BR" });
  });
  it("insere o nono dígito comprovado e preserva internacional", () => {
    expect(normalizeContactPhone("554195484515")).toMatchObject({ status: "valid", value: "5541995484515" });
    expect(normalizeContactPhone("+1 415 555 2671")).toMatchObject({ status: "valid", value: "14155552671", country: "international" });
    expect(sameContactPhone("(41) 99548-4515", "+55 41 99548-4515")).toBe(true);
  });
});
