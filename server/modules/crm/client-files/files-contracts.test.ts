import { describe, expect, it } from "vitest";
import {
  clientFileDeleteInput,
  clientFileDownloadInput,
  clientFileListInput,
  clientFileUploadInput,
} from "./files-contracts";

const canonicalId = "crm-11111111-1111-4111-8111-111111111111";
const filePublicId = "22222222-2222-4222-8222-222222222222";

describe("CRM client-files identity contract", () => {
  it.each([canonicalId, "legacy-person", "33333333-3333-4333-8333-333333333333"])("accepts canonical CRM identity %s at every boundary", crmClientId => {
    expect(clientFileListInput.parse({ crmClientId }).crmClientId).toBe(crmClientId);
    expect(clientFileUploadInput.parse({ crmClientId, fileName: "contrato.pdf", category: "contracts", mimeType: "application/pdf", base64: "AA==" }).crmClientId).toBe(crmClientId);
    expect(clientFileDeleteInput.parse({ crmClientId, filePublicId }).crmClientId).toBe(crmClientId);
    expect(clientFileDownloadInput.parse({ crmClientId, filePublicId }).crmClientId).toBe(crmClientId);
  });

  it.each(["", "   ", "x".repeat(81)])("rejects invalid CRM identity at every boundary", crmClientId => {
    expect(clientFileListInput.safeParse({ crmClientId }).success).toBe(false);
    expect(clientFileUploadInput.safeParse({ crmClientId, fileName: "contrato.pdf", category: "contracts", mimeType: "application/pdf", base64: "AA==" }).success).toBe(false);
    expect(clientFileDeleteInput.safeParse({ crmClientId, filePublicId }).success).toBe(false);
    expect(clientFileDownloadInput.safeParse({ crmClientId, filePublicId }).success).toBe(false);
  });

  it("continues requiring a UUID for the file identity", () => {
    expect(clientFileDeleteInput.safeParse({ crmClientId: canonicalId, filePublicId: "not-a-file-uuid" }).success).toBe(false);
    expect(clientFileDownloadInput.safeParse({ crmClientId: canonicalId, filePublicId: "not-a-file-uuid" }).success).toBe(false);
  });
});
