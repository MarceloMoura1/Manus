import { describe, expect, it } from "vitest";
import { buildTicketStatusCounts, resolveUnambiguousTenantLegacyDisplayName } from "./db-chamados";

describe("buildTicketStatusCounts", () => {
  it("returns all five card totals from the complete grouped result", () => {
    expect(buildTicketStatusCounts([
      { status: "open", count: "8" },
      { status: "in_progress", count: 4 },
      { status: "waiting", count: 3 },
      { status: "closed", count: 2 },
    ])).toEqual({ total: 17, open: 8, in_progress: 4, waiting: 3, closed: 2 });
  });

  it("keeps an empty tenant aggregate at zero without inferred values", () => {
    expect(buildTicketStatusCounts([])).toEqual({ total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 });
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
