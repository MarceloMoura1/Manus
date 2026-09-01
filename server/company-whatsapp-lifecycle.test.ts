import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  MEGADESK_SESSION_COOKIE,
  resolveOperationalSession,
  type OperationalSessionRepository,
  type StoredOperationalSession,
} from "./_core/megadesk-session";

const companyDb = vi.hoisted(() => ({
  getCompanySettings: vi.fn(),
  saveCompanySettings: vi.fn(),
}));
const whatsappDb = vi.hoisted(() => ({
  getWhatsappConfig: vi.fn(),
  saveWhatsappConfig: vi.fn(),
  updateConnectionStatus: vi.fn(),
  updateWebhookStatus: vi.fn(),
  deleteWhatsappConfig: vi.fn(),
}));

vi.mock("./db-company", () => companyDb);
vi.mock("./db-whatsapp", () => whatsappDb);

import { companyRouter } from "./routers-company";
import { whatsappRouter } from "./routers-whatsapp";

function context(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
    tenantId: "tenant-a",
    userEmail: "admin@example.invalid",
    operationalUserId: "user-a",
    operationalUserRole: "admin",
    operationalPermissions: [],
    ...overrides,
  };
}

const storedSession: StoredOperationalSession = {
  sessionId: "session-a",
  tokenHash: "hash",
  userId: "user-a",
  tenantId: "tenant-a",
  role: "admin",
  permissions: [],
  userEmail: "admin@example.invalid",
  sessionVersion: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2027-01-01T00:00:00Z"),
  lastUsedAt: new Date("2026-01-01T00:00:00Z"),
  revokedAt: null,
  tenantStatus: "active",
  accessReleased: true,
  userStatus: "active",
};

function repository(session: StoredOperationalSession | null): OperationalSessionRepository {
  return {
    replaceForIdentity: vi.fn(),
    findByTokenHash: vi.fn().mockResolvedValue(session),
    revokeByTokenHash: vi.fn(),
    touch: vi.fn(),
  };
}

describe("Company/WhatsApp operational lifecycle guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyDb.getCompanySettings.mockResolvedValue({ clientId: "tenant-a" });
    whatsappDb.getWhatsappConfig.mockResolvedValue({ clientId: "tenant-a", accessToken: "synthetic-token" });
  });

  it("allows the active and released tenant admin in Company and WhatsApp", async () => {
    await expect(companyRouter.createCaller(context()).getSettings({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ clientId: "tenant-a" });
    await expect(whatsappRouter.createCaller(context()).getConfig({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ clientId: "tenant-a" });
    expect(companyDb.getCompanySettings).toHaveBeenCalledWith("tenant-a");
    expect(whatsappDb.getWhatsappConfig).toHaveBeenCalledWith("tenant-a");
  });

  it.each([
    ["Company", () => companyRouter.createCaller(context()).getSettings({ clientId: "tenant-b" })],
    ["WhatsApp", () => whatsappRouter.createCaller(context()).getConfig({ clientId: "tenant-b" })],
  ])("rejects a cross-tenant clientId before %s repository access", async (_label, call) => {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(companyDb.getCompanySettings).not.toHaveBeenCalled();
    expect(whatsappDb.getWhatsappConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["Company", () => companyRouter.createCaller(context({ operationalUserRole: "manager" })).getSettings({ clientId: "tenant-a" })],
    ["WhatsApp", () => whatsappRouter.createCaller(context({ operationalUserRole: "agent" })).getConfig({ clientId: "tenant-a" })],
  ])("rejects a non-admin operational user in %s", async (_label, call) => {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["missing", null],
    ["paused", { ...storedSession, tenantStatus: "paused" }],
    ["not released", { ...storedSession, accessReleased: false }],
    ["blocked user", { ...storedSession, userStatus: "blocked" }],
  ])("does not resolve an operational identity when the tenant is %s", async (_label, session) => {
    const token = "A".repeat(43);
    const identity = await resolveOperationalSession(
      { headers: { cookie: `${MEGADESK_SESSION_COOKIE}=${token}` } },
      repository(session),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(identity).toBeNull();
  });
});
