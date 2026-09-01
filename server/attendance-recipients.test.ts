import { describe, expect, it, vi } from "vitest";
import { findAttendanceRecipientByPhone, searchAttendanceRecipients } from "./attendance-recipients";

const maskedCustomer = {
  crmClientId: "crm-masked-a",
  companyName: "Cliente de teste",
  responsibleName: "Pessoa de teste",
  phone: "(41) 99548-4515",
  whatsapp: null,
  email: null,
  contactsJson: "",
};

describe("attendance CRM recipient lookup", () => {
  it.each(["41995484515", "5541995484515", "+5541995484515", "(41) 99548-4515"])(
    "finds a legacy masked CRM phone for %s",
    async query => {
      const execute = vi.fn().mockResolvedValue([[maskedCustomer]]);
      const lookup = await searchAttendanceRecipients({ execute }, "tenant-a", query);

      expect(lookup.canonicalPhone).toBe("5541995484515");
      expect(lookup.candidates).toEqual([expect.objectContaining({
        crmClientId: "crm-masked-a", recipientPhone: "5541995484515", phone: "5541995484515",
      })]);
      const [sql, values] = execute.mock.calls[0];
      expect(sql).toContain("REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '')");
      expect(values[0]).toBe("tenant-a");
      expect(values).toContain("41995484515");
    },
  );

  it("uses the same CRM record when creating the direct outbound attendance", async () => {
    const execute = vi.fn().mockResolvedValue([[maskedCustomer]]);
    const customer = await findAttendanceRecipientByPhone({ execute }, "tenant-a", "+5541995484515");

    expect(customer).toMatchObject({ crmClientId: "crm-masked-a", recipientPhone: "5541995484515" });
    expect(execute.mock.calls[0][1][0]).toBe("tenant-a");
  });

  it("does not allow a CRM customer from another tenant to be selected", async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const lookup = await searchAttendanceRecipients({ execute }, "tenant-a", "41995484515");

    expect(lookup.candidates).toEqual([]);
    expect(execute.mock.calls[0][1][0]).toBe("tenant-a");
  });
});
