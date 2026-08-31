import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const home = source("client/src/pages/Home.tsx");
const workspace = source("client/src/pages/erp/ERPWorkspace.tsx");
const clients = source("client/src/pages/ClientesPage.tsx");
const attendance = source("client/src/pages/ActiveAttendance.tsx");
const router = source("server/routers-crm.ts");
const permissions = source("server/routers.ts");
const moduleTopbar = source("client/src/components/ModuleTopbar.tsx");

describe("central Clients restoration structure", () => {
  it("keeps Clients central inside ERP with a canonical and legacy route", () => {
    expect(home).toContain('window.location.pathname === "/clientes"');
    expect(home).toContain('window.location.pathname === "/erp/clientes"');
    expect(home).toContain('`/erp/clientes${window.location.search}${window.location.hash}`');
    expect(home).not.toContain('{ id: "clients" as RouteId, label: "Clientes"');
    expect(home.match(/label: "ERP"/g)).toHaveLength(1);
    expect(workspace).toContain('{id:"clients" as const,label:"Clientes",hidden:!canAccessClients}');
    expect(workspace.indexOf('label:"Resumo"')).toBeLessThan(workspace.indexOf('label:"Clientes"'));
    expect(workspace.indexOf('label:"Clientes"')).toBeLessThan(workspace.indexOf('label:"Produtos"'));
    expect(workspace).toContain('<ClientesPage initialSelectedId={initialCrmClientId}');
    expect(home).toContain('activeItemId={active.startsWith("erp-") ? erpSection : undefined}');
    expect(moduleTopbar).toContain('aria-current={isActive ? "page" : undefined}');
    expect(home).toContain('route === "clients" ? "erp-clients"');
    expect(home).toContain('window.addEventListener("popstate"');
  });

  it("keeps unauthorized actions out of the Clients DOM", () => {
    expect(clients).not.toContain("trpc.crm.delete");
    expect(clients).not.toContain("Excluir Cliente");
    expect(attendance).toContain("session?.permissions?.includes('clients')");
    expect(attendance).toContain("{ route: 'erp-clients', crmClientId: customerData.crmClientId }");
  });

  it("does not accept a public tenant in any CRM input", () => {
    expect(router).not.toContain("clientId: z.");
    expect(router).not.toContain("input.clientId");
    expect(router).toContain("ctx.tenantId");
    expect(router).toContain("customerId = ?");
    expect(router).not.toContain("customerId IS NULL OR customerId = ''");
    expect(router).not.toContain("customerName LIKE ? OR company LIKE ?");
  });

  it("includes clients in the backend module set while preserving the role boundary", () => {
    expect(permissions).toContain('"clients",');
    expect(permissions).toContain('permission !== "clients"');
    expect(permissions).toContain('agent: [...base, "active-attendance", "conversations", "tickets"]');
    expect(permissions).toContain('viewer: [...base, "tickets"]');
  });
});
