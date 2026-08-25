import { describe, expect, it, vi } from "vitest";
import { FiscalService } from "./service";
const admin = {
  clientId: "tenant-a",
  userId: "admin-a",
  role: "admin" as const,
};
describe("FiscalService", () => {
  it("blocks agent and viewer writes before repository access", async () => {
    const repo: any = { summary: vi.fn(), saveSettings: vi.fn() };
    const s = new FiscalService(repo, { publish: vi.fn() });
    await expect(s.summary({ ...admin, role: "agent" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      s.saveSettings({ ...admin, role: "viewer" }, {} as any)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.summary).not.toHaveBeenCalled();
    expect(repo.saveSettings).not.toHaveBeenCalled();
  });
  it("publishes only after repository success", async () => {
    const publish = vi.fn(),
      repo: any = {
        createSource: vi.fn().mockRejectedValue(new Error("rollback")),
      };
    const s = new FiscalService(repo, { publish });
    await expect(s.createSource(admin, {} as any)).rejects.toThrow("rollback");
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not publish on idempotent replay", async () => {
    const publish = vi.fn(),
      document = { publicId: crypto.randomUUID() },
      repo: any = {
        createManual: vi.fn().mockResolvedValue({ document, replay: true }),
        ready: vi.fn().mockResolvedValue({ document, replay: true }),
      };
    const s = new FiscalService(repo, { publish });
    await s.createManual(admin, {} as any);
    await s.ready(admin, document.publicId, crypto.randomUUID());
    expect(publish).not.toHaveBeenCalled();
  });
  it("uses minimal events for successful settings and documents", async () => {
    const publish = vi.fn(),
      id = crypto.randomUUID(),
      repo: any = {
        saveSettings: vi
          .fn()
          .mockResolvedValue({ publicId: id, operation: "created" }),
        cancel: vi.fn().mockResolvedValue({ publicId: id }),
      };
    const s = new FiscalService(repo, { publish });
    await s.saveSettings(admin, {} as any);
    await s.cancel(admin, id, "motivo");
    expect(publish).toHaveBeenNthCalledWith(
      1,
      "tenant-a",
      "erp:fiscal.settings.changed",
      expect.objectContaining({ publicId: id, operation: "created" })
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      "tenant-a",
      "erp:fiscal.document.changed",
      expect.objectContaining({ publicId: id, operation: "cancelled" })
    );
  });
});
