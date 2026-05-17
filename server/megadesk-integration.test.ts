import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMegaDeskContext(userRole: string = "agent"): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "megadesk-user",
    email: "agent@example.com",
    name: "Agent User",
    loginMethod: "megadesk",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {
        "x-tenant-id": "cliente-001",
        "x-user-role": userRole,
      },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    tenantId: "cliente-001",
    userRole,
  };

  return { ctx };
}

describe("MegaDesk Platform Integration", () => {
  it("should have MegaDesk context with tenant isolation", () => {
    const { ctx } = createMegaDeskContext();
    expect(ctx.tenantId).toBe("cliente-001");
    expect(ctx.userRole).toBe("agent");
    expect(ctx.user).toBeDefined();
  });

  it("should have assistant router available", () => {
    const caller = appRouter.createCaller(createMegaDeskContext().ctx);
    expect(caller.assistant).toBeDefined();
    expect(caller.assistant.chat).toBeDefined();
  });

  it("should have megadesk router with key procedures", () => {
    const caller = appRouter.createCaller(createMegaDeskContext().ctx);
    expect(caller.megadesk).toBeDefined();
    expect(caller.megadesk.overview).toBeDefined();
    expect(caller.megadesk.loginByEmail).toBeDefined();
    expect(caller.megadesk.sendMessage).toBeDefined();
    expect(caller.megadesk.updateTicketStatus).toBeDefined();
    expect(caller.megadesk.saveBotScript).toBeDefined();
  });

  it("should have megaadmin router available for admin users", () => {
    const caller = appRouter.createCaller(createMegaDeskContext().ctx);
    expect(caller.megaadmin).toBeDefined();
    expect(caller.megaadmin.summary).toBeDefined();
    expect(caller.megaadmin.listAdmins).toBeDefined();
  });

  it("should have auth router for session management", () => {
    const caller = appRouter.createCaller(createMegaDeskContext().ctx);
    expect(caller.auth).toBeDefined();
    expect(caller.auth.me).toBeDefined();
    expect(caller.auth.logout).toBeDefined();
  });
});
