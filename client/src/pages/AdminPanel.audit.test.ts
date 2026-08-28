import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAdminAuditState } from "./AdminPanel";

describe("AdminPanel audit states", () => {
  it.each([
    [{ eventPhase: "intent" as const, success: null }, "intent", "Em andamento"],
    [{ eventPhase: "success" as const, success: true }, "success", "Concluído"],
    [{ eventPhase: "failure" as const, success: false }, "failure", "Falhou"],
    [{ eventPhase: null, success: true }, "success", "Sucesso"],
    [{ eventPhase: null, success: false }, "failure", "Falha"],
    [{ eventPhase: null, success: null }, "unknown", "Resultado desconhecido"],
  ])("maps %o to %s", (input, kind, label) => {
    expect(resolveAdminAuditState(input)).toMatchObject({ kind, label });
  });

  it.each([
    { eventPhase: "intent" as const, success: true },
    { eventPhase: "intent" as const, success: false },
    { eventPhase: "success" as const, success: null },
    { eventPhase: "success" as const, success: false },
    { eventPhase: "failure" as const, success: null },
    { eventPhase: "failure" as const, success: true },
  ])("surfaces contradictory state safely: %o", input => {
    expect(resolveAdminAuditState(input)).toMatchObject({ kind: "inconsistent", label: "Estado inconsistente" });
  });

  it("uses text, accessible semantics and no sensitive audit fields", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");
    expect(source).toContain('role="status"');
    expect(source).toContain("aria-label={`${state.label}. ${state.description}`}");
    expect(source).not.toMatch(/log\.(metadata|sourceIp|operatorUserId|phone|message)/);
    expect(source).not.toContain('log.success ? "bg-emerald');
  });

  it("records only a safe aggregate when inconsistent rows are present", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");
    expect(source).toContain('console.warn("[AdminPanel] inconsistent audit state detected", { count: inconsistentCount })');
    expect(source).not.toMatch(/console\.warn\([^\n]*(metadata|action|operator|sourceIp)/);
    vi.restoreAllMocks();
  });
});
