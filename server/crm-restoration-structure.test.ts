import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const home = source("client/src/pages/Home.tsx");
const clients = source("client/src/pages/ClientesPage.tsx");
const attendance = source("client/src/pages/ActiveAttendance.tsx");
const router = source("server/routers-crm.ts");
const permissions = source("server/routers.ts");

describe("central Clients restoration structure", () => {
  it("keeps Clients central with a stable route and one ERP entry", () => {
    expect(home).toContain('window.location.pathname === "/clientes"');
    expect(home).toContain('{ id: "clients" as RouteId, label: "Clientes"');
    expect(home.match(/label: "ERP"/g)).toHaveLength(1);
    expect(home).toContain('route === "clients"');
    expect(home).toContain('window.addEventListener("popstate"');
  });

  it("keeps unauthorized actions out of the Clients DOM", () => {
    expect(clients).not.toContain("trpc.crm.delete");
    expect(clients).not.toContain("Excluir Cliente");
    expect(attendance).toContain("session?.permissions?.includes('clients')");
  });

  it("does not accept a public tenant in any CRM input", () => {
    expect(router).not.toContain("clientId: z.");
    expect(router).not.toContain("input.clientId");
    expect(router).toContain("ctx.tenantId");
    expect(router).toContain("customerId = ?");
    expect(router).toContain("customerId IS NULL OR customerId = ''");
  });

  it("includes clients in the backend module set while preserving the role boundary", () => {
    expect(permissions).toContain('"clients",');
    expect(permissions).toContain('permission !== "clients"');
    expect(permissions).toContain('agent: [...base, "active-attendance", "conversations", "tickets"]');
    expect(permissions).toContain('viewer: [...base, "tickets"]');
  });
});
