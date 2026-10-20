import { describe, expect, it } from "vitest";
import {
  activityListInput,
  activityDeleteInput,
  activityCreateInput,
  activityUpdateInput,
} from "./contracts";

describe("CRM Activities Contracts Validation", () => {
  const oppUuid = "11111111-1111-4111-8111-111111111111";
  const actUuid = "22222222-2222-4222-8222-222222222222";

  describe("activityCreateInput", () => {
    it("validates valid activity creation with opportunity link", () => {
      const parsed = activityCreateInput.parse({
        opportunityPublicId: oppUuid,
        type: "call",
        title: "Ligar para decisor",
        description: "Alinhar expectativas do fechamento do contrato",
      });

      expect(parsed.opportunityPublicId).toBe(oppUuid);
      expect(parsed.type).toBe("call");
      expect(parsed.title).toBe("Ligar para decisor");
    });

    it("validates valid activity creation with client link without opportunity", () => {
      const parsed = activityCreateInput.parse({
        crmClientId: "crm-client-456",
        type: "meeting",
        title: "Reunião de Demonstração",
      });

      expect(parsed.crmClientId).toBe("crm-client-456");
      expect(parsed.type).toBe("meeting");
    });

    it("rejects activity without either opportunity or client link", () => {
      expect(() =>
        activityCreateInput.parse({
          type: "task",
          title: "Atividade órfã",
        })
      ).toThrow();
    });
  });

  describe("activityListInput", () => {
    it("parses empty input with all fields optional", () => {
      const parsed = activityListInput.parse({});
      expect(parsed.search).toBeUndefined();
      expect(parsed.type).toBeUndefined();
    });

    it("parses filters including search, type, and status", () => {
      const parsed = activityListInput.parse({
        search: "apresentação",
        type: "followup",
        status: "pending",
        opportunityPublicId: oppUuid,
      });

      expect(parsed.search).toBe("apresentação");
      expect(parsed.type).toBe("followup");
      expect(parsed.status).toBe("pending");
      expect(parsed.opportunityPublicId).toBe(oppUuid);
    });
  });

  describe("activityDeleteInput", () => {
    it("accepts a valid UUID", () => {
      const parsed = activityDeleteInput.parse({
        activityPublicId: actUuid,
      });
      expect(parsed.activityPublicId).toBe(actUuid);
    });

    it("rejects non-UUID activity identifier", () => {
      expect(() =>
        activityDeleteInput.parse({
          activityPublicId: "not-a-valid-uuid",
        })
      ).toThrow();
    });
  });
});
