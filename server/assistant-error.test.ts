import { describe, expect, it } from "vitest";
import { classifyAssistantFailure } from "./assistant-error";

describe("assistant error disclosure boundary", () => {
  it("preserves safe actionable configuration and quota classes", () => {
    expect(classifyAssistantFailure(new Error("Token Gemini não configurado para este cliente. Solicite ao administrador.")))
      .toMatchObject({ code: "PRECONDITION_FAILED", errorClass: "CLIENT_GEMINI_NOT_CONFIGURED" });
    expect(classifyAssistantFailure(new Error("Quota mensal de tokens atingida (100 / 100 tokens).")))
      .toMatchObject({ code: "TOO_MANY_REQUESTS", errorClass: "CLIENT_GEMINI_QUOTA_EXCEEDED" });
  });

  it("never returns provider details, URLs, or credentials to the caller", () => {
    const secret = "provider failed at https://example.invalid?key=secret-api-key";
    const result = classifyAssistantFailure(new Error(secret));

    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.message).not.toContain("secret-api-key");
    expect(result.message).not.toContain("https://");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
