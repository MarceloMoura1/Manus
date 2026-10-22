import { describe, expect, it } from "vitest";
import {
  quotePdfGenerationInput,
  saleDocumentDeleteInput,
  saleDocumentTypes,
  saleDocumentUploadInput,
} from "./documents-contracts";

const id = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "99999999-9999-4999-8999-999999999999";

describe("sale document contracts", () => {
  it("accepts only the three approved manual categories", () => {
    expect(saleDocumentTypes).toEqual(["invoice", "content_declaration", "quote_pdf", "other"]);
    for (const documentType of ["invoice", "content_declaration", "other"] as const) {
      expect(() => saleDocumentUploadInput.parse({
        salePublicId: id,
        idempotencyKey,
        documentType,
        fileName: "documento.pdf",
        mimeType: "application/pdf",
        base64: Buffer.from("PDF").toString("base64"),
      })).not.toThrow();
    }
    expect(() => saleDocumentUploadInput.parse({
      salePublicId: id,
      idempotencyKey,
      documentType: "automatic_invoice",
      fileName: "documento.pdf",
      mimeType: "application/pdf",
      base64: Buffer.from("PDF").toString("base64"),
    })).toThrow();
  });

  it("requires tenant-resolved opaque sale and document identities", () => {
    expect(() => saleDocumentDeleteInput.parse({
      salePublicId: id,
      documentPublicId: "22222222-2222-4222-8222-222222222222",
    })).not.toThrow();
    expect(() => saleDocumentDeleteInput.parse({
      salePublicId: "../other-tenant",
      documentPublicId: id,
    })).toThrow();
  });

  it("reserves the generated quote PDF type for the server-side generation route", () => {
    const manual = {
      salePublicId: id,
      idempotencyKey,
      documentType: "quote_pdf",
      fileName: "orcamento-O-1024.pdf",
      description: null,
      mimeType: "application/pdf",
      base64: Buffer.from("%PDF-1.4\n%EOF\n").toString("base64"),
    };

    expect(saleDocumentUploadInput.safeParse(manual).success).toBe(false);
    expect(saleDocumentUploadInput.safeParse({ ...manual, documentType: "invoice" }).success).toBe(true);
    expect(quotePdfGenerationInput.safeParse({ salePublicId: id, idempotencyKey }).success).toBe(true);
  });
});
