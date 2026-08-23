import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  MEGADESK_SESSION_COOKIE,
  MemoryOperationalSessionRepository,
  assertOperationalCsrf,
  clearOperationalSessionCookie,
  createOperationalSession,
  hashOperationalSessionToken,
  operationalCookieOptions,
  readOperationalSessionToken,
  resolveOperationalSession,
  revokeOperationalSession,
} from "./_core/megadesk-session";

function request(cookie?: string, origin?: string): Request {
  return { headers: { cookie, origin }, secure: false } as Request;
}

function response() {
  return Object.assign(Object.create(null), { cookie: vi.fn(), clearCookie: vi.fn() }) as Response;
}

describe("MegaDesk operational session security", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
  });

  it("uses an opaque HttpOnly SameSite=Lax cookie", () => {
    expect(operationalCookieOptions(request())).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
  });

  it("forces Secure cookies in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(operationalCookieOptions(request()).secure).toBe(true);
  });

  it("stores only a SHA-256 token hash and resolves the identity", async () => {
    const repository = new MemoryOperationalSessionRepository();
    const res = response();
    await createOperationalSession({ userId: "user-1", clientId: "tenant-1" }, res, request(), repository);
    const rawToken = vi.mocked(res.cookie).mock.calls[0][1] as string;
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...repository.sessions.keys()]).toEqual([hashOperationalSessionToken(rawToken)]);
    expect(JSON.stringify([...repository.sessions.values()])).not.toContain(rawToken);
    const stored = repository.sessions.get(hashOperationalSessionToken(rawToken));
    if (!stored) throw new Error("session was not stored");
    stored.userEmail = "agent@example.com";
    stored.role = "agent";
    const identity = await resolveOperationalSession(request(`${MEGADESK_SESSION_COOKIE}=${rawToken}`), repository);
    expect(identity).toMatchObject({ tenantId: "tenant-1", userId: "user-1", role: "agent", userEmail: "agent@example.com" });
  });

  it("rotates the session and invalidates the previous token", async () => {
    const repository = new MemoryOperationalSessionRepository();
    const first = response();
    const second = response();
    await createOperationalSession({ userId: "user-1", clientId: "tenant-1" }, first, request(), repository);
    const firstToken = vi.mocked(first.cookie).mock.calls[0][1] as string;
    await createOperationalSession({ userId: "user-1", clientId: "tenant-1" }, second, request(), repository);
    expect(await resolveOperationalSession(request(`${MEGADESK_SESSION_COOKIE}=${firstToken}`), repository)).toBeNull();
  });

  it.each([
    ["revoked", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(0) }],
    ["blocked user", { userStatus: "blocked" }],
    ["paused tenant", { tenantStatus: "paused" }],
    ["unreleased tenant", { accessReleased: false }],
  ])("rejects a %s session", async (_label, changes) => {
    const repository = new MemoryOperationalSessionRepository();
    const res = response();
    await createOperationalSession({ userId: "user-1", clientId: "tenant-1" }, res, request(), repository);
    const token = vi.mocked(res.cookie).mock.calls[0][1] as string;
    const stored = repository.sessions.get(hashOperationalSessionToken(token));
    if (!stored) throw new Error("session was not stored");
    Object.assign(stored, changes);
    expect(await resolveOperationalSession(request(`${MEGADESK_SESSION_COOKIE}=${token}`), repository)).toBeNull();
  });

  it("revokes idempotently without exposing the token", async () => {
    const repository = new MemoryOperationalSessionRepository();
    const res = response();
    await createOperationalSession({ userId: "user-1", clientId: "tenant-1" }, res, request(), repository);
    const token = vi.mocked(res.cookie).mock.calls[0][1] as string;
    const req = request(`${MEGADESK_SESSION_COOKIE}=${token}`);
    expect(await revokeOperationalSession(req, repository)).toBe(true);
    expect(await revokeOperationalSession(req, repository)).toBe(false);
  });

  it("rejects malformed session cookies", () => {
    expect(readOperationalSessionToken(request(`${MEGADESK_SESSION_COOKIE}=not-a-token`))).toBeNull();
  });

  it("clears the cookie with matching security attributes", () => {
    const res = response();
    clearOperationalSessionCookie(res, request());
    expect(res.clearCookie).toHaveBeenCalledWith(MEGADESK_SESSION_COOKIE, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("allows configured origins and rejects foreign origins", () => {
    vi.stubEnv("MEGADESK_ALLOWED_ORIGINS", "https://app.example.test");
    expect(() => assertOperationalCsrf(request(undefined, "https://app.example.test"))).not.toThrow();
    expect(() => assertOperationalCsrf(request(undefined, "https://evil.example"))).toThrow("CSRF_ORIGIN_DENIED");
  });

  it("fails closed for missing origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEGADESK_ALLOWED_ORIGINS", "https://app.example.test");
    expect(() => assertOperationalCsrf(request())).toThrow("CSRF_ORIGIN_DENIED");
  });
});
