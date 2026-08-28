import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  evoCreateInstance: vi.fn(), evoGetQRCode: vi.fn(), evoGetStatus: vi.fn(),
  evoLogout: vi.fn(), evoSendText: vi.fn(), evoSetWebhook: vi.fn(), evoGetWebhookSummary: vi.fn(),
  getSession: vi.fn(), upsertSession: vi.fn(), deleteSession: vi.fn(), execute: vi.fn(),
}));

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  evoCreateInstance: mocks.evoCreateInstance,
  evoGetQRCode: mocks.evoGetQRCode,
  evoGetStatus: mocks.evoGetStatus,
  evoLogout: mocks.evoLogout,
  evoSendText: mocks.evoSendText,
  evoSetWebhook: mocks.evoSetWebhook,
  evoGetWebhookSummary: mocks.evoGetWebhookSummary,
}));
vi.mock("./session-store", () => ({
  getSession: mocks.getSession,
  upsertSession: mocks.upsertSession,
  deleteSession: mocks.deleteSession,
  instanceNameFor: (clientId: string) => `megadesk-${clientId}`,
}));
vi.mock("../db", () => ({ getPool: () => ({ execute: mocks.execute }) }));
vi.mock("./config", () => ({
  getEvolutionSafeOrigin: () => "http://evolution.test",
}));

import { EvolutionApiError } from "./client";
import { evolutionRouter, isExistingEvolutionInstanceError } from "./router";

function context(role: "admin" | "manager" | "agent" = "admin") {
  return {
    tenantId: "tenant-a", operationalUserId: `user-${role}`, operationalUserRole: role,
    operationalPermissions: ["conversations"], userEmail: `${role}@example.invalid`, req: { headers: {}, ip: "127.0.0.1" },
  } as any;
}

describe("Evolution contingency controls", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    mocks.execute.mockResolvedValue([{}]);
    mocks.getSession.mockResolvedValue(null);
    mocks.evoSetWebhook.mockResolvedValue(undefined);
    mocks.evoLogout.mockResolvedValue(undefined);
  });

  it("blocks connection changes for non-administrative roles", async () => {
    await expect(evolutionRouter.createCaller(context("agent")).connect({ clientId: "tenant-a" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.evoCreateInstance).not.toHaveBeenCalled();
  });

  it("requires an explicit destructive confirmation for logout", async () => {
    await expect(evolutionRouter.createCaller(context()).disconnect({ clientId: "tenant-a" } as never)).rejects.toBeDefined();
    expect(mocks.evoLogout).not.toHaveBeenCalled();
  });

  it("preserves the local session when provider logout fails", async () => {
    mocks.evoLogout.mockRejectedValue(new Error("provider unavailable"));
    await expect(evolutionRouter.createCaller(context()).disconnect({ clientId: "tenant-a", confirmation: "DESCONECTAR" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0][1]).toEqual(expect.arrayContaining(["evolution.logout", "tenant-a", null]));
    expect(mocks.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(["evolution.logout", "tenant-a", 0]));
  });

  it("repairs webhook and session without logging out", async () => {
    mocks.evoGetStatus.mockResolvedValue("connected");
    await expect(evolutionRouter.createCaller(context()).repair({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ ok: true, status: "connected", qrCode: null });
    expect(mocks.evoSetWebhook).toHaveBeenCalledOnce();
    expect(mocks.upsertSession).toHaveBeenCalledWith("tenant-a", "megadesk-tenant-a", "connected");
    expect(mocks.evoLogout).not.toHaveBeenCalled();
  });

  it("reports provider degradation without overwriting a connected session", async () => {
    mocks.getSession.mockResolvedValue({
      clientId: "tenant-a", instanceName: "megadesk-tenant-a", status: "connected",
      phoneNumber: "5541999999999", connectedAt: new Date(0),
    });
    mocks.evoGetStatus.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(evolutionRouter.createCaller(context()).getStatus({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ status: "connected", providerReachable: false });
    expect(mocks.upsertSession).not.toHaveBeenCalled();
    expect(mocks.evoSetWebhook).not.toHaveBeenCalled();
  });

  it("requires status 403 and a specific existing-instance message", () => {
    expect(isExistingEvolutionInstanceError(new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", "The instance already exists"))).toBe(true);
    for (const error of [
      new EvolutionApiError(400, "/instance/create", "EVOLUTION_REQUEST_FAILED", "The instance already exists"),
      new EvolutionApiError(409, "/instance/create", "EVOLUTION_CONFLICT", "already in use"),
      new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", "Forbidden"),
      new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", "invalid integration"),
      new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", ""),
    ]) expect(isExistingEvolutionInstanceError(error)).toBe(false);
  });

  it("reconnects an existing instance only for the proven 403 contract", async () => {
    mocks.evoGetStatus.mockResolvedValue("disconnected");
    mocks.evoCreateInstance.mockRejectedValue(new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", "Instance name tenant-a is already in use"));
    mocks.evoGetQRCode.mockResolvedValue({ base64: "data:image/png;base64," + "A".repeat(80) });
    await expect(evolutionRouter.createCaller(context()).connect({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ integrationStatus: "qr_required", webhookConfigured: true });
    expect(mocks.evoCreateInstance).toHaveBeenCalledOnce();
    expect(mocks.evoGetQRCode).toHaveBeenCalledOnce();
  });

  it("keeps a generic 403 as a safe failure", async () => {
    mocks.evoGetStatus.mockResolvedValue("disconnected");
    mocks.evoCreateInstance.mockRejectedValue(new EvolutionApiError(403, "/instance/create", "EVOLUTION_ACCESS_DENIED", "Forbidden"));
    await expect(evolutionRouter.createCaller(context()).connect({ clientId: "tenant-a" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível preparar a instância do WhatsApp." });
    expect(mocks.evoGetQRCode).not.toHaveBeenCalled();
  });

  it("does not call logout when intent auditing fails", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(evolutionRouter.createCaller(context()).disconnect({ clientId: "tenant-a", confirmation: "DESCONECTAR" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.evoLogout).not.toHaveBeenCalled();
  });

  it("does not repair when intent auditing fails", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(evolutionRouter.createCaller(context()).repair({ clientId: "tenant-a" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.evoGetStatus).not.toHaveBeenCalled();
    expect(mocks.evoSetWebhook).not.toHaveBeenCalled();
  });

  it("returns audit_degraded semantics when final logout audit fails", async () => {
    mocks.evoLogout.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(evolutionRouter.createCaller(context()).disconnect({ clientId: "tenant-a", confirmation: "DESCONECTAR" }))
      .resolves.toMatchObject({ ok: true, auditStatus: "degraded", integrationStatus: "disconnected" });
  });

  it("returns webhook_degraded instead of false repair success", async () => {
    mocks.evoGetStatus.mockResolvedValue("connected");
    mocks.evoSetWebhook.mockRejectedValue(new Error("provider refused webhook"));
    await expect(evolutionRouter.createCaller(context()).repair({ clientId: "tenant-a" }))
      .resolves.toMatchObject({ ok: false, providerRecovered: true, webhookConfigured: false, integrationStatus: "webhook_degraded" });
  });

  it("persists correlated structured audit fields without secrets", async () => {
    await evolutionRouter.createCaller(context()).disconnect({ clientId: "tenant-a", confirmation: "DESCONECTAR" });
    const intent = mocks.execute.mock.calls[0][1] as unknown[];
    const result = mocks.execute.mock.calls[1][1] as unknown[];
    expect(intent[4]).toBe(result[4]);
    expect(intent).toEqual(expect.arrayContaining(["user-admin", "admin", "megadesk-tenant-a", "whatsapp.settings", "intent", "127.0.0.1"]));
    expect(result).toEqual(expect.arrayContaining(["success"]));
    expect(JSON.stringify(mocks.execute.mock.calls)).not.toMatch(/api.?key|authorization|cookie|qrCode/i);
  });

  it("records an unavailable source IP instead of trusting a malformed header", async () => {
    const ctx = context(); ctx.req.ip = "not-an-ip"; ctx.req.headers["x-forwarded-for"] = "203.0.113.10";
    await evolutionRouter.createCaller(ctx).disconnect({ clientId: "tenant-a", confirmation: "DESCONECTAR" });
    const intent = mocks.execute.mock.calls[0][1] as unknown[];
    expect(intent[11]).toBeNull();
    expect(intent[12]).toContain('"sourceIpStatus":"unavailable"');
  });
});

describe("canonical audit migration 0012", () => {
  const sql = readFileSync(resolve(process.cwd(), "drizzle/main-migrations/0012_exotic_swarm.sql"), "utf8");
  it("changes only the audit table with nullable legacy-compatible fields and no backfill", () => {
    expect(new Set(Array.from(sql.matchAll(/ALTER TABLE `([^`]+)`/g), match => match[1]))).toEqual(new Set(["megadesk_domain_audit_logs"]));
    expect(sql).toContain("MODIFY COLUMN `success` tinyint DEFAULT 1");
    for (const field of ["operation_id", "operator_user_id", "operator_role", "instance_name", "origin", "event_phase", "error_code", "source_ip", "metadata_json"]) expect(sql).toContain(`ADD \`${field}\``);
    expect(sql).not.toMatch(/NOT NULL|UPDATE |DELETE |INSERT INTO/i);
  });
});
