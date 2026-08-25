import { describe, expect, it } from "vitest";
import {
  canReadFiscal,
  canWriteFiscal,
  fiscalEvent,
  fiscalSettingsInput,
  internalFiscalNumber,
  manualDocumentInput,
  productFiscalCompleteness,
  productFiscalProfileInput,
  settingsStatus,
} from "./contracts";
describe("fiscal contracts", () => {
  it("normalizes official classification fields without deriving taxes", () => {
    const x = fiscalSettingsInput.parse({
      taxRegime: "simples_nacional",
      taxpayerIndicator: "taxpayer",
      stateRegistration: " 123 ",
      municipalRegistration: null,
      mainCnae: "12.34-5/67",
      ibgeCityCode: "3550308",
      environment: "homologation",
      provider: "none",
    });
    expect(x.mainCnae).toBe("1234567");
    expect(settingsStatus(x)).toBe("ready_for_integration");
  });
  it("computes product completeness from configured classification only", () => {
    const x = productFiscalProfileInput.parse({
      productPublicId: crypto.randomUUID(),
      ncm: "1234.56.78",
      cest: null,
      defaultOutboundCfop: "5102",
      defaultInboundCfop: "1102",
      goodsOrigin: "0",
      fiscalUnit: "un",
      gtin: null,
      serviceCode: null,
      operationNature: null,
      internalNotes: null,
    });
    expect(x).toMatchObject({ ncm: "12345678", fiscalUnit: "UN" });
    expect(productFiscalCompleteness(x)).toBe("complete");
  });
  it("keeps roles immutable regardless of persisted permissions", () => {
    expect(canReadFiscal("viewer")).toBe(true);
    expect(canWriteFiscal("manager")).toBe(true);
    expect(canWriteFiscal("viewer")).toBe(false);
    expect(canReadFiscal("agent")).toBe(false);
  });
  it("formats an annual internal number without fiscal authorization semantics", () =>
    expect(internalFiscalNumber(2026, 42)).toBe("FIS-2026-000042"));
  it("accepts integer cents and quantity millis only", () => {
    const x = manualDocumentInput.parse({
      internalIssueDate: "2026-08-24",
      partyName: "Administrativo",
      partyDocument: null,
      internalNotes: null,
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          productPublicId: null,
          name: "Serviço interno",
          sku: null,
          quantityMillis: 1250,
          unitAmountCents: 399,
        },
      ],
    });
    expect(x.items[0]).toMatchObject({
      quantityMillis: 1250,
      unitAmountCents: 399,
    });
  });
  it("builds a private realtime payload", () => {
    const x = fiscalEvent(
      crypto.randomUUID(),
      "ready_for_integration",
      "2026-08-24T00:00:00.000Z"
    );
    expect(Object.keys(x).sort()).toEqual([
      "occurredAt",
      "operation",
      "publicId",
    ]);
    expect(JSON.stringify(x)).not.toMatch(
      /tenant|client|amount|party|document|cnae|ncm|reason|key/i
    );
  });
});
