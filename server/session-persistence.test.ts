import { describe, it, expect, beforeEach, afterEach } from "vitest";

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)); }
}

Object.defineProperties(globalThis, {
  localStorage: { value: new TestStorage(), configurable: true },
  sessionStorage: { value: new TestStorage(), configurable: true },
});

describe("Persistência de Sessão", () => {
  const MEGADESK_SESSION_KEY = "megadesk_session_v1";
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

  function loadSession(): MegaDeskSession | null {
    try {
      const raw = localStorage.getItem(MEGADESK_SESSION_KEY) ?? sessionStorage.getItem(MEGADESK_SESSION_KEY);
      if (!raw) return null;

      const session = JSON.parse(raw) as MegaDeskSession;

      // Se a sessão expirou, limpar e retornar null
      if (isSessionExpired(session)) {
        localStorage.removeItem(MEGADESK_SESSION_KEY);
        sessionStorage.removeItem(MEGADESK_SESSION_KEY);
        return null;
      }

      return session;
    } catch {
      localStorage.removeItem(MEGADESK_SESSION_KEY);
      sessionStorage.removeItem(MEGADESK_SESSION_KEY);
      return null;
    }
  }

  function saveSession(session: MegaDeskSession): MegaDeskSession {
    const now = Date.now();
    const sessionWithTimestamps: MegaDeskSession = {
      ...session,
      expiresAt: session.expiresAt || now + SESSION_DURATION,
      refreshedAt: session.refreshedAt || now,
    };
    localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(sessionWithTimestamps));
    return sessionWithTimestamps;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("deve salvar e carregar sessão do localStorage", () => {
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home", "active-attendance"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: ["active-attendance"],
    };

    const saved = saveSession(session);
    const loaded = loadSession();

    expect(loaded).not.toBeNull();
    expect(loaded?.userEmail).toBe(session.userEmail);
    expect(loaded?.userName).toBe(session.userName);
  });

  it("deve retornar null se sessão não existe", () => {
    const loaded = loadSession();
    expect(loaded).toBeNull();
  });

  it("deve limpar sessão expirada", () => {
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
      refreshedAt: now - 2000,
    };

    localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(expiredSession));

    const loaded = loadSession();
    expect(loaded).toBeNull();
    expect(localStorage.getItem(MEGADESK_SESSION_KEY)).toBeNull();
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
      refreshedAt: now,
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
      refreshedAt: now,
    };

    expect(shouldRefreshSession(session)).toBe(false);
  });

  it("deve manter sessão válida ao carregar", () => {
    const now = Date.now();
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "admin",
      permissions: ["home", "active-attendance"],
      clientId: "client-123",
      company: "Test Company",
      plan: "premium",
      modules: ["active-attendance"],
      expiresAt: now + 12 * 60 * 60 * 1000, // Expira em 12 horas
      refreshedAt: now,
    };

    saveSession(session);
    const loaded = loadSession();

    expect(loaded).not.toBeNull();
    expect(loaded?.userEmail).toBe(session.userEmail);
    expect(loaded?.expiresAt).toBe(session.expiresAt);
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

    const saved = saveSession(session);

    expect(saved.expiresAt).toBeDefined();
    expect(saved.refreshedAt).toBeDefined();
    expect(saved.expiresAt).toBeGreaterThan(Date.now());
  });

  it("deve recuperar sessão mesmo após recarregar página", () => {
    const session: MegaDeskSession = {
      userEmail: "user@example.com",
      userName: "Test User",
      userRole: "agent",
      permissions: ["home", "conversations"],
      clientId: "client-456",
      company: "Another Company",
      plan: "basic",
      modules: ["conversations"],
    };

    const saved = saveSession(session);

    // Simular recarregar página (limpar variáveis em memória)
    const loaded = loadSession();

    expect(loaded).not.toBeNull();
    expect(loaded?.userEmail).toBe(session.userEmail);
    expect(loaded?.userRole).toBe(session.userRole);
    expect(loaded?.permissions).toEqual(session.permissions);
  });

  it("deve lidar com localStorage corrompido", () => {
    localStorage.setItem(MEGADESK_SESSION_KEY, "invalid json {");

    const loaded = loadSession();

    expect(loaded).toBeNull();
    expect(localStorage.getItem(MEGADESK_SESSION_KEY)).toBeNull();
  });

  it("deve preferir localStorage sobre sessionStorage", () => {
    const session1: MegaDeskSession = {
      userEmail: "user1@example.com",
      userName: "User 1",
      userRole: "admin",
      permissions: ["home"],
      clientId: "client-1",
      company: "Company 1",
      plan: "premium",
      modules: [],
    };

    const session2: MegaDeskSession = {
      userEmail: "user2@example.com",
      userName: "User 2",
      userRole: "viewer",
      permissions: ["home"],
      clientId: "client-2",
      company: "Company 2",
      plan: "basic",
      modules: [],
    };

    localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(session1));
    sessionStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(session2));

    const loaded = loadSession();

    expect(loaded?.userEmail).toBe(session1.userEmail);
  });
});
