import { describe, expect, it, vi } from "vitest";
import { findConversationContactByPhone, searchLightweightContactsForAttendance } from "./conversation-contact";

describe("lightweight conversation contacts", () => {
  it.each(["(41) 99548-4515", "41 99548-4515", "41995484515", "5541995484515", "+5541995484515"])(
    "uses one canonical identity for %s",
    async phone => {
      const execute = vi.fn().mockResolvedValue([[{
        contactId: "contact-a", displayName: "João Victor", canonicalPhone: "5541995484515", crmClientId: null,
      }]]);
      await expect(findConversationContactByPhone("tenant-a", phone, { execute })).resolves.toMatchObject({
        contactId: "contact-a", displayName: "João Victor", canonicalPhone: "5541995484515",
      });
      expect(execute.mock.calls[0][1]).toEqual(["tenant-a", "5541995484515", "5541995484515"]);
    },
  );

  it("searches only standalone contacts within the tenant", async () => {
    const execute = vi.fn().mockResolvedValue([[{
      contactId: "contact-light", displayName: "João Victor", canonicalPhone: "5541995484515", crmClientId: null,
    }]]);
    const result = await searchLightweightContactsForAttendance("tenant-a", "João", { execute });

    expect(result).toMatchObject({ canonicalPhone: null, contacts: [expect.objectContaining({ contactId: "contact-light" })] });
    expect(execute.mock.calls[0][0]).toContain("crm_client_id IS NULL");
    expect(execute.mock.calls[0][1]).toEqual(["tenant-a", "%João%"]);
  });
});
