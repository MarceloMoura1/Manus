import { describe, expect, it } from "vitest";
import { formatContactPhone, hasHumanContactName, normalizeContactPhone } from "./contact-phone";

describe("conversation contact identity", () => {
  it.each(["(41) 99548-4515", "41 99548-4515", "41995484515", "5541995484515", "+5541995484515"])(
    "normalizes %s to the canonical Brazilian phone",
    input => expect(normalizeContactPhone(input)).toMatchObject({ status: "valid", value: "5541995484515" }),
  );

  it("does not treat a stored phone as a human contact name", () => {
    expect(hasHumanContactName("5541995484515", "5541995484515")).toBe(false);
    expect(hasHumanContactName("(41) 99548-4515", "5541995484515")).toBe(false);
    expect(hasHumanContactName("João Victor", "5541995484515")).toBe(true);
    expect(formatContactPhone("5541995484515")).toBe("+55 41 99548-4515");
  });
});
