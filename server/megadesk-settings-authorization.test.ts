import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("./db", () => ({
  getPool: () => ({ execute: mocks.execute }),
}));

vi.mock("./sync-megadesk", () => ({
  syncClientDataToDb: vi.fn(),
  syncTeamUsersToDb: vi.fn(),
  validateSyncIntegrity: vi.fn(),
  getSyncedClientData: vi.fn().mockResolvedValue(null),
}));

import { megadeskSettingsRouter } from "./routers-megadesk-settings";

function caller(role: "admin" | "manager" | "agent" | "viewer") {
  return megadeskSettingsRouter.createCaller({
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

describe("MegaDesk settings authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([[], []]);
  });

  it.each(["manager", "agent", "viewer"] as const)(
    "does not trust an admin role supplied by a %s caller",
    async (role) => {
      await expect(caller(role).getCompanySettings({ clientId: "tenant-a", userRole: "admin" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role).saveCompanySettings({ clientId: "tenant-a", userRole: "admin", companyName: "Forged" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it("uses the authenticated admin role even when the legacy input claims otherwise", async () => {
    await expect(caller("admin").getCompanySettings({ clientId: "tenant-a", userRole: "viewer" }))
      .resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
