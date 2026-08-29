import { describe, expect, it, vi } from "vitest";
import { duplicateConstraint, generateConversationPublicCode, isDuplicateKeyError, withPublicCodeRetry } from "./conversation-public-code";

describe("conversation public code", () => {
  const instant = new Date("2026-08-29T09:50:23.000Z");

  it("uses the approved stable format", () => {
    expect(generateConversationPublicCode(instant, () => Buffer.from([0, 1, 2, 3])))
      .toBe("CV-260829095023-2345");
  });

  it("creates distinct codes in the same second", () => {
    const first = generateConversationPublicCode(instant, () => Buffer.from([0, 1, 2, 3]));
    const second = generateConversationPublicCode(instant, () => Buffer.from([4, 5, 6, 7]));
    expect(first).not.toBe(second);
  });

  it("recognizes MySQL duplicate errors used by the limited retry", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError(new Error("other"))).toBe(false);
  });

  it("extracts the violated MySQL constraint", () => {
    expect(duplicateConstraint({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry 'x' for key 'megadesk.uq_mdc_public_code'" })).toBe("uq_mdc_public_code");
  });

  it("retries only public-code collisions and succeeds with the next code", async () => {
    const codes = ["first", "second"];
    const operation = vi.fn(async (code: string) => {
      if (code === "first") throw { code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_public_code'" };
      return code;
    });
    await expect(withPublicCodeRetry(operation, { generate: () => codes.shift()! })).resolves.toBe("second");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("uses exactly five attempts and exposes the final database error", async () => {
    const error = { code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_public_code'" };
    const operation = vi.fn(async () => { throw error; });
    await expect(withPublicCodeRetry(operation, { generate: () => "forced" })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(5);
  });

  it("does not retry active-key conflicts", async () => {
    const error = { code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_active_key'" };
    const operation = vi.fn(async () => { throw error; });
    await expect(withPublicCodeRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
