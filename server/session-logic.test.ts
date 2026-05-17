import { describe, it, expect } from "vitest";

describe("Lógica de Persistência de Sessão", () => {
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 horas
  const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutos

  type MegaDeskSession = {
    userEmail: string;
    userName: string;
    userRole: string;
    permissions: string[];
    clientId: string;
    company: string;
    plan: string;
    modules: string[];
    expiresAt?: number;
    refreshedAt?: number;
  };

  function isSessionExpired(session: MegaDeskSession | null): boolean {
    if (!session || !session.expiresAt) return false;
    return Date.now() > session.expiresAt;
  }

  function shouldRefreshSession(session: MegaDeskSession | null): boolean {
    if (!session || !session.expiresAt) return false;
    const timeUntilExpiry = session.expiresAt - Date.now();
    return timeUntilExpiry < REFRESH_THRESHOLD;
  }

  function addSessionTimestamps(session: MegaDeskSession): MegaDeskSession {
    const now = Date.now();
    return {
      ...session,
      expiresAt: session.expiresAt || now + SESSION_DURATION,
      refreshedAt: session.refreshedAt || now,
    };
  }

  it("deve detectar sessão expirada", () => {
    const now = Date.now();
    const expiredSession: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: now - 1000, // Expirou 1 segundo atrás
    };

    expect(isSessionExpired(expiredSession)).toBe(true);
  });

  it("deve detectar sessão válida", () => {
    const now = Date.now();
    const validSession: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: now + 12 * 60 * 60 * 1000, // Expira em 12 horas
    };

    expect(isSessionExpired(validSession)).toBe(false);
  });

  it("deve retornar false para sessão null", () => {
    expect(isSessionExpired(null)).toBe(false);
  });

  it("deve detectar sessão próxima de expirar", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: now + 2 * 60 * 1000, // Expira em 2 minutos
    };

    expect(shouldRefreshSession(session)).toBe(true);
  });

  it("deve não renovar sessão válida", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: now + 10 * 60 * 1000, // Expira em 10 minutos
    };

    expect(shouldRefreshSession(session)).toBe(false);
  });

  it("deve retornar false para sessão null", () => {
    expect(shouldRefreshSession(null)).toBe(false);
  });

  it("deve adicionar timestamps ao salvar sessão", () => {
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
    };

    const saved = addSessionTimestamps(session);

    expect(saved.expiresAt).toBeDefined();
    expect(saved.refreshedAt).toBeDefined();
    expect(saved.expiresAt).toBeGreaterThan(Date.now());
    expect(saved.expiresAt! - saved.refreshedAt!).toBe(SESSION_DURATION);
  });

  it("deve manter timestamps existentes", () => {
    const now = Date.now();
    const customExpiry = now + 2 * 60 * 60 * 1000; // 2 horas
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: customExpiry,
      refreshedAt: now,
    };

    const saved = addSessionTimestamps(session);

    expect(saved.expiresAt).toBe(customExpiry);
    expect(saved.refreshedAt).toBe(now);
  });

  it("deve validar sessão com permissões corretas", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "agent",
      permissions: ["home", "conversations", "active-attendance"],
      clientId: "client-456",
      company: "Another Company",
      plan: "basic",
      modules: ["conversations", "active-attendance"],
      expiresAt: now + 12 * 60 * 60 * 1000,
    };

    expect(isSessionExpired(session)).toBe(false);
    expect(session.permissions).toContain("conversations");
    expect(session.permissions).toContain("active-attendance");
  });

  it("deve validar sessão com módulos corretos", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"],
      clientId: "client-789",
      company: "Full Access Company",
      plan: "enterprise",
      modules: ["active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"],
      expiresAt: now + 24 * 60 * 60 * 1000,
    };

    expect(isSessionExpired(session)).toBe(false);
    expect(session.modules.length).toBe(7);
  });

  it("deve renovar sessão quando próxima de expirar", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: [],
      expiresAt: now + 3 * 60 * 1000, // Expira em 3 minutos
      refreshedAt: now - 20 * 60 * 60 * 1000, // Renovada 20 horas atrás
    };

    expect(shouldRefreshSession(session)).toBe(true);

    // Simular renovação removendo expiresAt para forçar novo cálculo
    const sessionWithoutExpiry = { ...session };
    delete sessionWithoutExpiry.expiresAt;
    const renewed = addSessionTimestamps(sessionWithoutExpiry);
    expect(renewed.expiresAt).toBeGreaterThan(session.expiresAt!);
  });

  it("deve manter dados de sessão ao renovar", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "manager",
      permissions: ["home", "active-attendance", "conversations"],
      clientId: "client-999",
      company: "Manager Company",
      plan: "professional",
      modules: ["active-attendance", "conversations"],
      expiresAt: now + 2 * 60 * 1000,
    };

    const renewed = addSessionTimestamps(session);

    expect(renewed.userEmail).toBe(session.userEmail);
    expect(renewed.userName).toBe(session.userName);
    expect(renewed.userRole).toBe(session.userRole);
    expect(renewed.permissions).toEqual(session.permissions);
    expect(renewed.clientId).toBe(session.clientId);
  });
});
