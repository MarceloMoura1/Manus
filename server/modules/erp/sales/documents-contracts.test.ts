import { describe, expect, it } from "vitest";
import {
  saleDocumentDeleteInput,
  saleDocumentTypes,
  saleDocumentUploadInput,
} from "./documents-contracts";

const id = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "99999999-9999-4999-8999-999999999999";

describe("sale document contracts", () => {
  it("accepts only the three approved manual categories", () => {
    expect(saleDocumentTypes).toEqual(["invoice", "content_declaration", "other"]);
    for (const documentType of saleDocumentTypes) {
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
});
