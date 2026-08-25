import { describe, expect, it } from "vitest";
import {
  canExportReports,
  canReadReports,
  comparison,
  csvCell,
  previousPeriod,
  reportRequestInput,
  rowsToCsv,
} from "./contracts";
describe("reports contracts", () => {
  it("validates inclusive UTC periods and rejects inverted or excessive intervals", () => {
    expect(
      reportRequestInput.safeParse({
        section: "sales",
        from: "2026-01-01",
        to: "2026-01-31",
      }).success
    ).toBe(true);
    expect(
      reportRequestInput.safeParse({
        section: "sales",
        from: "2026-02-01",
        to: "2026-01-01",
      }).success
    ).toBe(false);
    expect(
      reportRequestInput.safeParse({
        section: "sales",
        from: "2024-01-01",
        to: "2026-01-01",
      }).success
    ).toBe(false);
  });
  it("allows readers but reserves export to admin and manager", () => {
    expect(canReadReports("viewer")).toBe(true);
    expect(canExportReports("viewer")).toBe(false);
    expect(canExportReports("manager")).toBe(true);
    expect(canReadReports("agent")).toBe(false);
  });
  it("calculates the immediately preceding period and avoids division by zero", () => {
    expect(previousPeriod("2026-02-01", "2026-02-10")).toEqual({
      from: "2026-01-22",
      to: "2026-01-31",
    });
    expect(comparison(10, 0)).toEqual({ current: 10, previous: 0, absoluteChange: 10, percentageChange: null });
    expect(comparison(15, 10).percentageChange).toBe(50);
  });
  it("accepts only sorting and states belonging to the selected section", () => {
    const base = { section: "sales", from: "2026-01-01", to: "2026-01-31" };
    expect(reportRequestInput.safeParse({ ...base, sort: "customer", status: "fulfilled" }).success).toBe(true);
    expect(reportRequestInput.safeParse({ ...base, sort: "supplier" }).success).toBe(false);
    expect(reportRequestInput.safeParse({ ...base, status: "received" }).success).toBe(false);
    expect(reportRequestInput.safeParse({ ...base, direction: "sideways" }).success).toBe(false);
    expect(reportRequestInput.safeParse({ ...base, pageSize: 101 }).success).toBe(false);
  });
  it("neutralizes spreadsheet formulas and quotes CSV", () => {
    for (const x of ["=1+1", "+SUM(A1)", "-2", "@cmd", "\tbad", "\rbad"])
      expect(csvCell(x)).toContain("'");
    expect(rowsToCsv([{ name: 'a"b', valueCents: 12 }])).toContain('"a""b"');
  });
});
