import { describe, expect, it } from "vitest";
import { operatorDisplayName } from "./conversation-operator-name";

describe("operatorDisplayName", () => {
  it("uses the canonical operator name", () => {
    expect(operatorDisplayName({ agentName: "Marcelo Moura" })).toBe("Marcelo Moura");
  });

  it("does not display a legacy email snapshot as a sender name", () => {
    expect(operatorDisplayName({ agentName: "marcelo@example.test" })).toBe("Operador");
  });

  it("uses a neutral fallback when the historical sender name is unavailable", () => {
    expect(operatorDisplayName({})).toBe("Operador");
  });
});
