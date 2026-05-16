/**
 * Testes de persistência de sessão do MegaDesk
 *
 * Valida que a sessão persiste após F5 (reload de página),
 * e que o checkbox "Lembrar meu acesso" controla apenas a duração.
 */

import { describe, it, expect } from "vitest";

// Simula as constantes e funções do Home.tsx
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 horas
const SESSION_DURATION_LONG = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MEGADESK_SESSION_KEY = "megadesk_session_v1";

type MegaDeskSession = {
  clientId: string;
  company: string;
  permissions: string[];
  userName: string;
  userEmail: string;
  userRole: "admin" | "manager" | "agent" | "viewer";
  plan: string;
  modules: string[];
  expiresAt?: number;
  refreshedAt?: number;
};

// Simula o localStorage em memória para testes
function createMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function saveSession(storage: ReturnType<typeof createMockStorage>, session: MegaDeskSession, rememberMe?: boolean) {
  const now = Date.now();
  const duration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION;
  const sessionWithTimestamps: MegaDeskSession = {
    ...session,
    expiresAt: session.expiresAt || now + duration,
    refreshedAt: session.refreshedAt || now,
  };
  // SEMPRE salvar no localStorage (não sessionStorage)
  storage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(sessionWithTimestamps));
  return sessionWithTimestamps;
}

function loadSession(storage: ReturnType<typeof createMockStorage>): MegaDeskSession | null {
  try {
    const raw = storage.getItem(MEGADESK_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as MegaDeskSession;
    if (session.expiresAt && Date.now() > session.expiresAt) {
      storage.removeItem(MEGADESK_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

const mockSession: MegaDeskSession = {
  clientId: "client-123",
  company: "Empresa Teste",
  permissions: ["home", "conversations", "tickets"],
  userName: "João Silva",
  userEmail: "joao@empresa.com",
  userRole: "agent",
  plan: "pro",
  modules: ["conversas", "chamados"],
};

// ─── Testes de persistência ───────────────────────────────────────────────────

describe("Persistência de sessão MegaDesk após F5", () => {
  it("deve salvar sessão no localStorage ao fazer login (sem rememberMe)", () => {
    const storage = createMockStorage();
    saveSession(storage, mockSession, false);

    // Simula F5: localStorage persiste, sessionStorage seria limpo
    const loaded = loadSession(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.userEmail).toBe("joao@empresa.com");
    expect(loaded?.clientId).toBe("client-123");
  });

  it("deve salvar sessão no localStorage ao fazer login (com rememberMe)", () => {
    const storage = createMockStorage();
    saveSession(storage, mockSession, true);

    const loaded = loadSession(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.userEmail).toBe("joao@empresa.com");
  });

  it("sem rememberMe: sessão deve expirar em ~24 horas", () => {
    const storage = createMockStorage();
    const saved = saveSession(storage, mockSession, false);

    const expectedExpiry = Date.now() + SESSION_DURATION;
    expect(saved.expiresAt).toBeDefined();
    // Tolerância de 1 segundo
    expect(Math.abs((saved.expiresAt ?? 0) - expectedExpiry)).toBeLessThan(1000);
  });

  it("com rememberMe: sessão deve expirar em ~30 dias", () => {
    const storage = createMockStorage();
    const saved = saveSession(storage, mockSession, true);

    const expectedExpiry = Date.now() + SESSION_DURATION_LONG;
    expect(saved.expiresAt).toBeDefined();
    // Tolerância de 1 segundo
    expect(Math.abs((saved.expiresAt ?? 0) - expectedExpiry)).toBeLessThan(1000);
  });

  it("deve retornar null se sessão expirou", () => {
    const storage = createMockStorage();
    const expiredSession: MegaDeskSession = {
      ...mockSession,
      expiresAt: Date.now() - 1000, // expirou 1 segundo atrás
    };
    storage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(expiredSession));

    const loaded = loadSession(storage);
    expect(loaded).toBeNull();
    // Deve limpar do storage
    expect(storage.getItem(MEGADESK_SESSION_KEY)).toBeNull();
  });

  it("deve retornar null se não há sessão salva (usuário nunca logou)", () => {
    const storage = createMockStorage();
    const loaded = loadSession(storage);
    expect(loaded).toBeNull();
  });

  it("deve preservar todos os dados da sessão após salvar e carregar", () => {
    const storage = createMockStorage();
    saveSession(storage, mockSession, false);
    const loaded = loadSession(storage);

    expect(loaded?.clientId).toBe(mockSession.clientId);
    expect(loaded?.company).toBe(mockSession.company);
    expect(loaded?.permissions).toEqual(mockSession.permissions);
    expect(loaded?.userName).toBe(mockSession.userName);
    expect(loaded?.userEmail).toBe(mockSession.userEmail);
    expect(loaded?.userRole).toBe(mockSession.userRole);
    expect(loaded?.plan).toBe(mockSession.plan);
    expect(loaded?.modules).toEqual(mockSession.modules);
  });

  it("deve manter a sessão válida após múltiplos 'F5' (reloads)", () => {
    const storage = createMockStorage();
    saveSession(storage, mockSession, false);

    // Simula 5 reloads de página
    for (let i = 0; i < 5; i++) {
      const loaded = loadSession(storage);
      expect(loaded).not.toBeNull();
      expect(loaded?.userEmail).toBe("joao@empresa.com");
    }
  });

  it("deve limpar sessão ao fazer logout", () => {
    const storage = createMockStorage();
    saveSession(storage, mockSession, false);

    // Simula logout
    storage.removeItem(MEGADESK_SESSION_KEY);

    const loaded = loadSession(storage);
    expect(loaded).toBeNull();
  });

  it("duração sem rememberMe deve ser 24 horas (86400000 ms)", () => {
    expect(SESSION_DURATION).toBe(86400000);
  });

  it("duração com rememberMe deve ser 30 dias (2592000000 ms)", () => {
    expect(SESSION_DURATION_LONG).toBe(2592000000);
  });

  it("duração com rememberMe deve ser 30x maior que sem rememberMe", () => {
    expect(SESSION_DURATION_LONG).toBe(SESSION_DURATION * 30);
  });
});
