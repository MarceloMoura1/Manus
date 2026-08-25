import { describe, expect, it, vi } from "vitest";
import { ReportsService } from "./service";
const input = {
  section: "sales" as const,
  from: "2026-01-01",
  to: "2026-01-31",
  page: 1,
  pageSize: 20,
  sort: "date" as const,
  direction: "desc" as const,
};
describe("reports service", () => {
  it("blocks agent before invoking the repository", async () => {
    const repository = { report: vi.fn() } as any,
      s = new ReportsService(repository);
    await expect(
      s.report({ clientId: "a", userId: "u", role: "agent" }, input)
    ).rejects.toThrow("não permite");
    expect(repository.report).not.toHaveBeenCalled();
  });
  it("makes viewer read-only and manager export CSV without personal fields", async () => {
    const repository = {
        report: vi
          .fn()
          .mockResolvedValue([
            { publicId: "p", name: "Empresa", valueCents: 100 },
          ]),
      } as any,
      s = new ReportsService(repository);
    expect(
      (await s.report({ clientId: "a", userId: "u", role: "viewer" }, input))
        .canExport
    ).toBe(false);
    await expect(
      s.exportCsv(
        { clientId: "a", userId: "u", role: "viewer" },
        { ...input, maxRows: 10 }
      )
    ).rejects.toThrow("exportar");
    const csv = await s.exportCsv(
      { clientId: "a", userId: "u", role: "manager" },
      { ...input, maxRows: 10 }
    );
    expect(csv.contentType).toBe("text/csv; charset=utf-8");
    expect(csv.content).not.toMatch(/client_id|cpf|email|phone/i);
  });
  it("integrates exact executive comparisons and null when the previous base is zero", async () => {
    const repository = { report: vi.fn()
      .mockResolvedValueOnce({ sales: { count: 2, valueCents: 3000 }, purchases: { count: 1, valueCents: 900 }, settlements: { receivedCents: 500, paidCents: 200 } })
      .mockResolvedValueOnce({ sales: { count: 1, valueCents: 1000 }, purchases: { count: 0, valueCents: 0 }, settlements: { receivedCents: 0, paidCents: 100 } }) } as any;
    const result = await new ReportsService(repository).report(
      { clientId: "a", userId: "u", role: "admin" },
      { ...input, section: "executive", sort: undefined }
    );
    expect(result.comparison?.fulfilledSalesValueCents).toEqual({ current: 3000, previous: 1000, absoluteChange: 2000, percentageChange: 200 });
    expect(result.comparison?.receivedPurchasesValueCents.percentageChange).toBeNull();
    expect(repository.report).toHaveBeenNthCalledWith(2, "a", "executive", expect.objectContaining({ from: "2025-12-01", to: "2025-12-31" }));
  });
});
