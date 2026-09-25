import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clients = readFileSync("client/src/pages/ClientesPage.tsx", "utf8");
const home = readFileSync("client/src/pages/Home.tsx", "utf8");
const suppliers = readFileSync("client/src/pages/erp/SuppliersPage.tsx", "utf8");

describe("Clientes profile regression guards", () => {
  it("terminates files loading in recoverable error/data/empty states with the supplier empty-state copy", () => {
    expect(clients).toContain("filesQuery.isLoading");
    expect(clients).toContain("filesQuery.isError");
    expect(clients).toContain("filesQuery.refetch()");
    expect(clients).toContain("Nenhum documento anexado");
    expect(clients).toContain("Anexar primeiro documento");
    expect(suppliers).toContain("Nenhum documento anexado");
  });

  it("keeps CSV, Exportar and Novo in a non-clipping three-column action row", () => {
    expect(clients).toContain('className="grid w-full grid-cols-3 gap-1.5"');
    expect(clients).toContain("Importar clientes via CSV");
    expect(clients).toContain("Exportar clientes em CSV");
    expect(clients).toMatch(/<Plus className="w-4 h-4" \/>\s*Novo/);
    expect(clients).toContain('selectedClient ? "hidden flex-shrink-0 lg:flex lg:w-80 xl:w-96" : "flex-1"');
  });

  it("passes admin authorization through the shell and always exposes an explained delete action", () => {
    expect(home).toContain('canPermanentlyDeleteClients={session.userRole === "admin"}');
    expect(clients).toContain("disabled={!canPermanentlyDelete}");
    expect(clients).toContain("Somente administradores podem excluir clientes definitivamente");
    expect(clients).toContain('deletePhrase !== "EXCLUIR"');
    expect(clients).toContain("Excluir cliente definitivamente");
  });

  it("keeps dependency failures in the open modal and closes, clears and refetches after success", () => {
    expect(clients).toContain("setRiskError(message)");
    expect(clients).toContain('{riskError && (');
    expect(clients).toMatch(/await deleteMutation\.mutateAsync\([\s\S]*?setRiskAction\(null\);[\s\S]*?setDeletePhrase\(""\);[\s\S]*?await onDeleted\(\);/);
    expect(clients).toMatch(/onDeleted=\{async \(\) => \{[\s\S]*?setSelectedClientId\(null\);[\s\S]*?await refetch\(\);/);
  });
});
