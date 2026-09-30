import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWaAccount: vi.fn(),
  listWaAccounts: vi.fn(),
  getWaAccountById: vi.fn(),
  updateWaAccountStatus: vi.fn(),
  getPhoneNumberInfo: vi.fn(),
}));

vi.mock("./repositories/whatsapp.repo", () => ({
  createWaAccount: mocks.createWaAccount,
  listWaAccounts: mocks.listWaAccounts,
  getWaAccountById: mocks.getWaAccountById,
  updateWaAccount: vi.fn(),
  updateWaAccountStatus: mocks.updateWaAccountStatus,
  deleteWaAccount: vi.fn(),
}));

vi.mock("./meta/graph-api", () => ({
  getPhoneNumberInfo: mocks.getPhoneNumberInfo,
}));

import { connectAccount, listAccounts } from "./services/whatsapp-account.service";
import { whatsappRouter } from "./whatsapp.router";

const account = {
  id: "account-a",
  clientId: "tenant-a",
  displayName: "Primary",
  phoneNumberId: "phone-a",
  businessAccountId: "business-a",
  accessToken: "provider-secret-token",
  webhookVerifyToken: "webhook-secret-token",
  status: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function caller(role: "admin" | "manager" | "agent" | "viewer") {
  return whatsappRouter.createCaller({
    tenantId: "tenant-a",
    userEmail: `${role}@example.invalid`,
    operationalUserId: `${role}-a`,
    operationalUserRole: role,
    operationalPermissions: [],
    user: null,
    req: { headers: {} },
    res: {},
  } as never);
}

describe("WhatsApp account security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWaAccounts.mockResolvedValue([account]);
    mocks.getWaAccountById.mockResolvedValue(account);
    mocks.createWaAccount.mockResolvedValue(account);
    mocks.updateWaAccountStatus.mockResolvedValue(undefined);
  });

  it("does not expose provider or webhook verification secrets in account listings", async () => {
    const [result] = await listAccounts("tenant-a");

    expect(result).toMatchObject({
      id: "account-a",
      clientId: "tenant-a",
      accessTokenConfigured: true,
      webhookVerifyTokenConfigured: true,
    });
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("webhookVerifyToken");
    expect(JSON.stringify(result)).not.toContain("provider-secret-token");
    expect(JSON.stringify(result)).not.toContain("webhook-secret-token");
  });

  it.each(["manager", "agent", "viewer"] as const)(
    "rejects %s access to WhatsApp account configuration",
    async (role) => {
      await expect(caller(role).listAccounts({ clientId: "tenant-a" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.listWaAccounts).not.toHaveBeenCalled();
    },
  );

  it("allows an admin to read only sanitized account metadata", async () => {
    const [result] = await caller("admin").listAccounts({ clientId: "tenant-a" });

    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("webhookVerifyToken");
    expect(mocks.listWaAccounts).toHaveBeenCalledWith("tenant-a");
  });

  it.each([
    [new Error("Bearer SECRET stack at https://internal-host/path?token=SECRET"), "PROVIDER_UNKNOWN"],
    [Object.assign(new Error("apiKey=SECRET"), { status: 401 }), "PROVIDER_AUTH_FAILED"],
    [Object.assign(new Error('{"password":"SECRET"}<html>arbitrary</html>'), { status: 429 }), "PROVIDER_RATE_LIMITED"],
    [Object.assign(new Error("request timed out Authorization: SECRET"), { name: "TimeoutError" }), "PROVIDER_TIMEOUT"],
    [Object.assign(new Error("ECONNRESET token=SECRET"), { status: 503 }), "PROVIDER_UNAVAILABLE"],
  ])("returns and logs only bounded diagnostics for provider failure %#", async (providerError, expectedClass) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.getPhoneNumberInfo.mockRejectedValueOnce(providerError);

    const rejection = await connectAccount({
      clientId: "tenant-a",
      displayName: "Primary",
      phoneNumberId: "phone-a",
      businessAccountId: "business-a",
      accessToken: "caller-secret-token",
      webhookVerifyToken: "webhook-secret-token",
    }).catch(error => error);

    const serializedError = JSON.stringify(rejection);
    const serializedLogs = JSON.stringify(warn.mock.calls);
    for (const forbidden of ["Bearer SECRET", "apiKey=SECRET", "internal-host", "token=SECRET", "password", "<html>",
      "Authorization: SECRET", "caller-secret-token", "webhook-secret-token", "stack at"]) {
      expect(serializedError).not.toContain(forbidden);
      expect(serializedLogs).not.toContain(forbidden);
    }
    expect(rejection).toMatchObject({ code: "BAD_REQUEST" });
    expect(rejection.message).toMatch(/Referência: [0-9a-f-]{36}$/i);
    expect(warn).toHaveBeenCalledWith("[WhatsApp Account] Falha sanitizada ao conectar provider.", expect.objectContaining({
      failureClass: expectedClass,
    }));
    warn.mockRestore();
  });
});
