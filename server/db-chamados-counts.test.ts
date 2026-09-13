import { describe, expect, it } from "vitest";
import { buildTicketStatusCounts, resolveUnambiguousTenantLegacyDisplayName } from "./db-chamados";

describe("buildTicketStatusCounts", () => {
  it("keeps an empty tenant aggregate at zero without inferred values", () => {
    expect(buildTicketStatusCounts([])).toEqual({ total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 });
  });

  it("counts only active tickets when the scoped aggregate has no closed tickets", () => {
    expect(buildTicketStatusCounts([
      { status: "open", count: "8" },
      { status: "in_progress", count: 4 },
      { status: "waiting", count: 3 },
    ])).toEqual({ total: 15, open: 8, in_progress: 4, waiting: 3, closed: 0 });
  });

  it("excludes a closed-only scoped aggregate from Total", () => {
    expect(buildTicketStatusCounts([
      { status: "closed", count: 7 },
    ])).toEqual({ total: 0, open: 0, in_progress: 0, waiting: 0, closed: 7 });
  });

  it("separates active and closed tickets without counting one ticket in both cards", () => {
    expect(buildTicketStatusCounts([
      { status: "open", count: 8 },
      { status: "in_progress", count: 4 },
      { status: "waiting", count: 3 },
      { status: "closed", count: 2 },
    ])).toEqual({ total: 15, open: 8, in_progress: 4, waiting: 3, closed: 2 });
  });

  it("moves a ticket from Total to Fechados when it is closed", () => {
    const beforeClose = buildTicketStatusCounts([{ status: "open", count: 1 }]);
    const afterClose = buildTicketStatusCounts([{ status: "closed", count: 1 }]);

    expect(afterClose.total).toBe(beforeClose.total - 1);
    expect(afterClose.closed).toBe(beforeClose.closed + 1);
  });

  it("counts an unrecognized active status in Total without changing the fixed status cards", () => {
    expect(buildTicketStatusCounts([
      { status: "open", count: 2 },
      { status: "triage", count: 5 },
      { status: "closed", count: 3 },
    ])).toEqual({ total: 7, open: 2, in_progress: 0, waiting: 0, closed: 3 });
  });

  it("preserves the active-total rule for complete Todos and Meus aggregates", () => {
    const todos = buildTicketStatusCounts([
      { status: "open", count: 120 },
      { status: "waiting", count: 80 },
      { status: "closed", count: 40 },
    ]);
    const meus = buildTicketStatusCounts([
      { status: "in_progress", count: 2 },
      { status: "closed", count: 1 },
    ]);

    expect(todos).toMatchObject({ total: 200, closed: 40 });
    expect(meus).toMatchObject({ total: 2, closed: 1 });
  });
});

describe("legacy primary assignee resolution", () => {
  const current = { userId: "operator-a", userName: "Marcelo Operador" };

  it("resolves a historical textual assignee only when it is unique in the active tenant", () => {
    expect(resolveUnambiguousTenantLegacyDisplayName("tenant-a", current, [
      { clientId: "tenant-a", userId: "operator-a", userName: "Marcelo Operador" },
    ])).toBe("Marcelo Operador");
  });

  it("fails closed for an ambiguous display name in the same tenant", () => {
    expect(resolveUnambiguousTenantLegacyDisplayName("tenant-a", current, [
      { clientId: "tenant-a", userId: "operator-a", userName: "Marcelo Operador" },
      { clientId: "tenant-a", userId: "operator-b", userName: "Marcelo Operador" },
    ])).toBeNull();
  });

  it("does not let a same-name operator from another tenant participate in resolution", () => {
    expect(resolveUnambiguousTenantLegacyDisplayName("tenant-a", current, [
      { clientId: "tenant-a", userId: "operator-a", userName: "Marcelo Operador" },
      { clientId: "tenant-b", userId: "operator-b", userName: "Marcelo Operador" },
    ])).toBe("Marcelo Operador");
    expect(resolveUnambiguousTenantLegacyDisplayName("tenant-a", current, [
      { clientId: "tenant-b", userId: "operator-a", userName: "Marcelo Operador" },
    ])).toBeNull();
  });
});
