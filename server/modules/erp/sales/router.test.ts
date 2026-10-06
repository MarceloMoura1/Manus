import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("./service", () => ({
  SaleService: class {
    list = mocks.list;
  },
}));

import {
  SALES_PUBLIC_ERROR_MESSAGE,
  hasSalesModuleAccess,
  salesRouter,
} from "./router";

type Role = "admin" | "manager" | "agent" | "viewer";

function context(role: Role, permissions: string[] = ["erp"]) {
  return {
    tenantId: "tenant-session",
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    operationalSessionId: `session-${role}`,
    userEmail: `${role}@example.invalid`,
    req: { headers: {} },
    res: {},
    user: null,
  } as never;
}

describe("sales router authorization and error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    mocks.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
      canWrite: false,
    });
  });

  it.each(["admin", "manager", "agent", "viewer"] as const)(
    "allows %s to read sales when the session grants ERP access",
    async role => {
      const result = await salesRouter.createCaller(context(role)).list({});

      expect(result.items).toEqual([]);
      expect(mocks.list).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "tenant-session",
          role,
          userId: `user-${role}`,
        }),
        expect.any(Object)
      );
    }
  );

  it("denies the request before repository access when ERP permission is absent", async () => {
    expect(hasSalesModuleAccess({ operationalPermissions: ["clients"] })).toBe(
      false
    );
    await expect(
      salesRouter.createCaller(context("admin", ["clients"])).list({})
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Acesso ao módulo ERP indisponível.",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("applies the same ERP gate to private sale documents", async () => {
    await expect(
      salesRouter.createCaller(context("admin", ["clients"])).documents.list({
        salePublicId: "11111111-1111-4111-8111-111111111111",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Acesso ao módulo ERP indisponível.",
    });
  });

  it("returns a stable public error and logs only safe diagnostics", async () => {
    const diagnostic = Object.assign(
      new Error("password=super-secret; SELECT * FROM private_table"),
      {
        code: "ER_PARSE_ERROR",
        errno: 1064,
        sqlState: "42000",
        sql: "SELECT private_secret FROM credentials",
      }
    );
    mocks.list.mockRejectedValue(diagnostic);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      salesRouter.createCaller(context("manager")).list({})
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: SALES_PUBLIC_ERROR_MESSAGE,
    });

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain("sales.list");
    expect(logged).toContain("ER_PARSE_ERROR");
    expect(logged).not.toContain("super-secret");
    expect(logged).not.toContain("private_table");
    expect(logged).not.toContain("private_secret");
  });
});
