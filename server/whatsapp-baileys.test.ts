import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getPool: vi.fn() }));

describe("Evolution manager without an initialized adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("fails closed when a message is sent before initialization", async () => {
    const { sendWhatsAppMessage } = await import("./evolution-manager");

    await expect(
      sendWhatsAppMessage("tenant-a", "conversation-a", "5511999999999", "Olá")
    ).resolves.toEqual({ ok: false, error: "Evolution Adapter não inicializado" });
  });

  it("returns an error state before initialization", async () => {
    const { getWhatsAppStatus } = await import("./evolution-manager");

    expect(getWhatsAppStatus("tenant-a")).toEqual({
      status: "error",
      connected: false,
    });
  });

  it("fails closed when disconnect is requested before initialization", async () => {
    const { disconnectWhatsApp } = await import("./evolution-manager");

    await expect(disconnectWhatsApp("tenant-a")).resolves.toEqual({
      ok: false,
      error: "Evolution Adapter não inicializado",
    });
  });
});
