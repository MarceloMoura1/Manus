import { describe, expect, it } from "vitest";
import { ErpDomainError, erpTrpcCode } from "../errors";
import { canWriteSuppliers, normalizeSupplierInput, supplierEvent, supplierInput, supplierListInput } from "./contracts";

const legal = { legalName:"  ACME   Brasil  ",tradeName:"  ",personType:"legal" as const,taxId:"12.345.678/0001-90",stateRegistration:"  IE 1 ",email:" CONTATO@EXAMPLE.COM ",phone:" 11 9999-0000 ",contactName:"  Maria   Silva ",postalCode:"01.234-567",street:" Rua A ",addressNumber:" 10 ",addressComplement:" ",district:" Centro ",city:" São Paulo ",state:"sp",notes:"  observação  " };

describe("ERP supplier contracts",()=>{
  it("normalizes CPF/CNPJ to digits",()=>expect(normalizeSupplierInput(supplierInput.parse(legal)).taxId).toBe("12345678000190"));
  it("normalizes email and optional text",()=>{const item=normalizeSupplierInput(supplierInput.parse(legal));expect(item.email).toBe("contato@example.com");expect(item.tradeName).toBeNull();expect(item.contactName).toBe("Maria Silva");});
  it("normalizes CEP and UF",()=>{const item=normalizeSupplierInput(supplierInput.parse(legal));expect([item.postalCode,item.state]).toEqual(["01234567","SP"]);});
  it("accepts an optional tax id",()=>expect(supplierInput.safeParse({...legal,taxId:""}).success).toBe(true));
  it("requires 14 digits for a legal entity",()=>expect(supplierInput.safeParse({...legal,taxId:"12345678901"}).success).toBe(false));
  it("requires 11 digits for an individual",()=>expect(supplierInput.safeParse({...legal,personType:"individual",taxId:"123.456.789-01"}).success).toBe(true));
  it("rejects an invalid UF",()=>expect(supplierInput.safeParse({...legal,state:"São Paulo"}).success).toBe(false));
  it("defaults safe pagination and ordering",()=>expect(supplierListInput.parse({})).toMatchObject({sort:"legalName",direction:"asc",page:1,pageSize:20}));
  it("accepts the supported filters",()=>expect(supplierListInput.parse({search:"acme",active:true,city:"Recife",state:"pe"})).toMatchObject({search:"acme",active:true,city:"Recife",state:"PE"}));
  it.each(["name","taxId","DROP TABLE","id"])("rejects ordering outside the allowlist: %s",sort=>expect(supplierListInput.safeParse({sort}).success).toBe(false));
  it.each(["admin","manager"] as const)("allows %s to write",role=>expect(canWriteSuppliers(role)).toBe(true));
  it.each(["agent","viewer"] as const)("keeps %s read-only",role=>expect(canWriteSuppliers(role)).toBe(false));
  it("uses a minimal realtime payload",()=>{const payload=supplierEvent(crypto.randomUUID(),"updated","2026-01-01T00:00:00.000Z");expect(Object.keys(payload).sort()).toEqual(["occurredAt","operation","publicId"]);expect(JSON.stringify(payload)).not.toMatch(/client|tax|email|phone|address|notes/i);});
  it.each([["NOT_FOUND","NOT_FOUND"],["FORBIDDEN","FORBIDDEN"],["CONFLICT","CONFLICT"],["VALIDATION","BAD_REQUEST"]] as const)("translates %s consistently",(domain,trpc)=>expect(erpTrpcCode(new ErpDomainError(domain,"public"))).toBe(trpc));
});
