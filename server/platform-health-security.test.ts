import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

const req = { headers: {}, ip: "127.0.0.1" } as any;
const res = { cookie: () => undefined, clearCookie: () => undefined } as any;

describe("platform health security and isolation", () => {
  it("blocks non-platform administrators", async () => {
    const caller = appRouter.createCaller({ req, res, user: { id: 2, role: "user" } } as any);
    await expect(caller.megaadmin.platformHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("blocks anonymous users", async () => {
    const caller = appRouter.createCaller({ req, res, user: null } as any);
    await expect(caller.megaadmin.platformHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("resolves instances server-side and scopes history by client id", () => {
    const source = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    expect(source).toContain("instanceNameFor(client.clientId)");
    expect(source).toContain("WHERE client_id = ?");
    expect(source).not.toMatch(/instanceName:\s*z\.string[\s\S]{0,120}tenantPlatformHealth/);
  });
  it("does not probe a tenant without the WhatsApp module", () => {
    const source = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    const helper = source.slice(source.indexOf("async function collectTenantIntegration"), source.indexOf("async function collectPlatformHealth"));
    expect(helper.indexOf('return { contract: "not_contracted"')).toBeLessThan(helper.indexOf("evoGetStatus"));
  });
  it("locks repair per authoritative tenant and uses the canonical operation", () => {
    const source = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    expect(source).toContain("platformRepairInFlight.has(client.clientId)");
    expect(source).toContain("runCanonicalEvolutionRepair({ tenantId: client.clientId");
    expect(source).toContain('includeQr: false');
    expect(source).not.toContain("evoLogout(client.clientId");
  });
});
