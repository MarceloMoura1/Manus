import { afterEach, describe, expect, it, vi } from "vitest";
import { testGeminiConnection } from "./gemini-client";

describe("Gemini wrapper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("handles a valid provider response without real network access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    }));
    await expect(testGeminiConnection("fake-test-key")).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("handles an invalid provider response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) }));
    await expect(testGeminiConnection("fake-test-key")).resolves.toEqual({ ok: false, message: "Gemini não retornou resposta válida." });
  });

  it("sanitizes provider authentication errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { status: "API_KEY_INVALID", message: "API key not valid" } }),
    }));
    const result = await testGeminiConnection("fake-test-key");
    expect(result).toEqual({ ok: false, message: "Token inválido. Verifique a chave da API Gemini." });
    expect(result.message).not.toContain("fake-test-key");
  });

  it("handles network failures without leaking the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const result = await testGeminiConnection("fake-test-key");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("network unavailable");
    expect(result.message).not.toContain("fake-test-key");
  });
});

