import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import { isTestDatabaseEnabled } from "./test-integration-gates";
const integrationIt = it.runIf(isTestDatabaseEnabled());
const integrationDescribe = describe.runIf(isTestDatabaseEnabled());

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockReq = { headers: {}, cookies: {} } as any;
const mockRes = { cookie: () => {}, clearCookie: () => {} } as any;

const adminCaller = appRouter.createCaller({
  req: mockReq,
  res: mockRes,
  user: { id: 1, email: "marcelo.mouraadmpro@gmail.com", name: "Marcelo", role: "admin" as const },
});

const userCaller = appRouter.createCaller({
  req: mockReq,
  res: mockRes,
  user: { id: 2, email: "user@test.com", name: "User", role: "user" as const },
});

const anonCaller = appRouter.createCaller({
  req: mockReq,
  res: mockRes,
  user: null,
});

// ─── createClient ─────────────────────────────────────────────────────────────
describe("megaadmin.createClient", () => {
  integrationIt("cria cliente com todos os campos obrigatórios", async () => {
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa Teste Vitest",
      contact: "João Teste",
      email: "joao@empresa-teste.com",
      phone: "+55 11 99999-0001",
      plan: "Suporte + WhatsApp",
      maxUsers: 10,
      statusType: "test",
      idempotencyKey: "vitest-create-complete-001",
    });
    expect(result.ok).toBe(true);
    expect(result.client.company).toBe("Empresa Teste Vitest");
    expect(result.client.maxUsers).toBe(10);
    expect(result.client.statusType).toBe("test");
    expect(result.integrationToken).toBeTruthy();
  });

  integrationIt("cria cliente com status ativo", async () => {
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa Ativa Vitest",
      contact: "Maria Ativa",
      email: "maria@ativa.com",
      phone: "+55 11 99999-0002",
      plan: "Plano Profissional",
      maxUsers: 20,
      statusType: "active",
      idempotencyKey: "vitest-create-active-001",
    });
    expect(result.ok).toBe(true);
    expect(result.client.statusType).toBe("active");
  });

  integrationIt("cria cliente com CNPJ preenchido", async () => {
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa CNPJ Vitest",
      contact: "Carlos CNPJ",
      email: "carlos@cnpj.com",
      phone: "+55 11 99999-0003",
      plan: "Plano Básico",
      cnpj: "12.345.678/0001-99",
      maxUsers: 5,
      statusType: "test",
      idempotencyKey: "vitest-create-cnpj-001",
    });
    expect(result.ok).toBe(true);
    expect(result.client.cnpj).toBe("12345678000199");
  });

  it("rejeita empresa com nome muito curto", async () => {
    await expect(
      adminCaller.megaadmin.createClient({
        company: "A",
        contact: "Contato",
        email: "email@test.com",
        phone: "+55 11 99999-0004",
        plan: "Plano Básico",
        maxUsers: 5,
        statusType: "test",
        idempotencyKey: "vitest-invalid-company-001",
      }),
    ).rejects.toThrow();
  });

  it("rejeita e-mail inválido", async () => {
    await expect(
      adminCaller.megaadmin.createClient({
        company: "Empresa Válida",
        contact: "Contato",
        email: "email-invalido",
        phone: "+55 11 99999-0005",
        plan: "Plano Básico",
        maxUsers: 5,
        statusType: "test",
        idempotencyKey: "vitest-invalid-email-001",
      }),
    ).rejects.toThrow();
  });

  it("bloqueia criação por usuário comum", async () => {
    await expect(
      userCaller.megaadmin.createClient({
        company: "Empresa Bloqueada",
        contact: "Contato",
        email: "email@bloqueado.com",
        phone: "+55 11 99999-0006",
        plan: "Plano Básico",
        maxUsers: 5,
        statusType: "test",
      }),
    ).rejects.toThrow();
  });
});

// ─── updateClientInfo ─────────────────────────────────────────────────────────
describe("megaadmin.updateClientInfo", () => {
  let testClientId: string;

  beforeAll(async () => {
    if (!isTestDatabaseEnabled()) return;
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa Update Vitest",
      contact: "Contato Update",
      email: "update@empresa.com",
      phone: "+55 11 99999-0010",
      plan: "Plano Básico",
      maxUsers: 3,
      statusType: "test",
      idempotencyKey: "vitest-update-client-001",
    });
    testClientId = result.client.clientId;
  });

  integrationIt("atualiza campos do cliente", async () => {
    const result = await adminCaller.megaadmin.updateClientInfo({
      clientId: testClientId,
      company: "Empresa Update Modificada",
      maxUsers: 15,
      statusType: "active",
    });
    expect(result.ok).toBe(true);
    expect(result.client.company).toBe("Empresa Update Modificada");
    expect(result.client.maxUsers).toBe(15);
    expect(result.client.statusType).toBe("active");
  });

  integrationIt("retorna erro para clientId inexistente", async () => {
    await expect(
      adminCaller.megaadmin.updateClientInfo({
        clientId: "cliente-inexistente-999",
        company: "Empresa X",
      }),
    ).rejects.toThrow();
  });

  it("bloqueia atualização por usuário comum", async () => {
    await expect(
      userCaller.megaadmin.updateClientInfo({
        clientId: testClientId,
        company: "Bloqueado",
      }),
    ).rejects.toThrow();
  });
});

// ─── saveClientIntegrations ───────────────────────────────────────────────────
describe("megaadmin.saveClientIntegrations", () => {
  let testClientId: string;

  beforeAll(async () => {
    if (!isTestDatabaseEnabled()) return;
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa Integrações Vitest",
      contact: "Contato Integ",
      email: "integ@empresa.com",
      phone: "+55 11 99999-0020",
      plan: "Plano Profissional",
      maxUsers: 5,
      statusType: "test",
      idempotencyKey: "vitest-integrations-client-001",
    });
    testClientId = result.client.clientId;
  });

  integrationIt("salva integrações do cliente", async () => {
    const result = await adminCaller.megaadmin.saveClientIntegrations({
      clientId: testClientId,
      integrations: {
        geminiKey: "AIzaTestKey12345",
        n8nUrl: "https://n8n.empresa.com",
        n8nToken: "n8n-token-test",
        erpNotes: "ERP em implantação",
      },
    });
    expect(result.ok).toBe(true);
  });

  integrationIt("salva credenciais de rastreio", async () => {
    const result = await adminCaller.megaadmin.saveClientIntegrations({
      clientId: testClientId,
      integrations: {
        trackingToken: "track-token-123",
        trackingUser: "usuario_correios",
        trackingPassword: "senha_correios",
        trackingContract: "9912345678",
      },
    });
    expect(result.ok).toBe(true);
  });

  integrationIt("retorna erro para clientId inexistente", async () => {
    await expect(
      adminCaller.megaadmin.saveClientIntegrations({
        clientId: "cliente-inexistente-999",
        integrations: { geminiKey: "key" },
      }),
    ).rejects.toThrow();
  });
});

// ─── testIntegration ──────────────────────────────────────────────────────────
integrationDescribe("megaadmin.testIntegration", () => {
  let testClientId: string;

  beforeAll(async () => {
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa TestInteg Vitest",
      contact: "Contato TestInteg",
      email: "testinteg@empresa.com",
      phone: "+55 11 99999-0030",
      plan: "Plano Básico",
      maxUsers: 5,
      statusType: "test",
      idempotencyKey: "vitest-test-integration-001",
    });
    testClientId = result.client.clientId;
    // Salvar integrações para testar
    await adminCaller.megaadmin.saveClientIntegrations({
      clientId: testClientId,
      integrations: {
        geminiKey: "AIzaTestKeyLongEnough12345",
        trackingToken: "track-123",
        n8nUrl: "https://n8n.test.com",
        n8nToken: "n8n-token-valid",
      },
    });
  });

  it("testa integração Gemini com chave válida", async () => {
    const result = await adminCaller.megaadmin.testIntegration({
      clientId: testClientId,
      type: "gemini",
    });
    expect(result.ok).toBe(false);
  });

  it("testa integração de rastreio com token válido", async () => {
    const result = await adminCaller.megaadmin.testIntegration({
      clientId: testClientId,
      type: "tracking",
    });
    expect(result.ok).toBe(true);
  });

  it("testa integração n8n com URL e token válidos", async () => {
    const result = await adminCaller.megaadmin.testIntegration({
      clientId: testClientId,
      type: "n8n",
    });
    expect(result.ok).toBe(true);
  });

  it("retorna falha para Gemini sem chave configurada", async () => {
    const emptyResult = await adminCaller.megaadmin.createClient({
      company: "Empresa Sem Integ",
      contact: "Contato",
      email: "seminteg@empresa.com",
      phone: "+55 11 99999-0031",
      plan: "Plano Básico",
      maxUsers: 5,
      statusType: "test",
      idempotencyKey: "vitest-no-integration-001",
    });
    const result = await adminCaller.megaadmin.testIntegration({
      clientId: emptyResult.client.clientId,
      type: "gemini",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

// ─── resetUserPassword ────────────────────────────────────────────────────────
describe("megaadmin.resetUserPassword", () => {
  let testClientId: string;
  let testUserId: string;

  beforeAll(async () => {
    if (!isTestDatabaseEnabled()) return;
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa ResetPwd Vitest",
      contact: "Contato ResetPwd",
      email: "resetpwd@empresa.com",
      phone: "+55 11 99999-0040",
      plan: "Plano Básico",
      maxUsers: 5,
      statusType: "test",
      idempotencyKey: "vitest-reset-password-001",
    });
    testClientId = result.client.clientId;
    testUserId = result.client.users[0]?.id;
  });

  integrationIt("reseta senha de um usuário existente", async () => {
    const result = await adminCaller.megaadmin.resetUserPassword({
      clientId: testClientId,
      userId: testUserId,
      newPassword: "novaSenha123",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBeTruthy();
  });

  it("rejeita senha com menos de 6 caracteres", async () => {
    await expect(
      adminCaller.megaadmin.resetUserPassword({
        clientId: testClientId,
        userId: testUserId,
        newPassword: "abc",
      }),
    ).rejects.toThrow();
  });

  integrationIt("retorna erro para userId inexistente", async () => {
    await expect(
      adminCaller.megaadmin.resetUserPassword({
        clientId: testClientId,
        userId: "user-inexistente-999",
        newPassword: "novaSenha123",
      }),
    ).rejects.toThrow();
  });

  it("bloqueia reset por usuário comum", async () => {
    await expect(
      userCaller.megaadmin.resetUserPassword({
        clientId: testClientId,
        userId: testUserId,
        newPassword: "novaSenha123",
      }),
    ).rejects.toThrow();
  });
});

// ─── Controle de limite de usuários ──────────────────────────────────────────
integrationDescribe("Controle de limite de usuários por cliente", () => {
  let testClientId: string;

  beforeAll(async () => {
    const result = await adminCaller.megaadmin.createClient({
      company: "Empresa Limite Vitest",
      contact: "Contato Limite",
      email: "limite@empresa.com",
      phone: "+55 11 99999-0050",
      plan: "Plano Básico",
      maxUsers: 2, // Limite de 2 usuários
      statusType: "test",
      idempotencyKey: "vitest-user-limit-001",
    });
    testClientId = result.client.clientId;
  });

  it("permite adicionar usuário dentro do limite", async () => {
    // O cliente já tem 1 usuário (admin criado no cadastro), maxUsers=2
    const result = await adminCaller.megaadmin.addClientUser({
      clientId: testClientId,
      name: "Usuário Dentro do Limite",
      email: "dentro@limite.com",
      role: "agent",
    });
    expect(result.ok).toBe(true);
  });

  it("impede exceder o limite de usuários", async () => {
    // Agora tem 2 usuários, maxUsers=2 — deve rejeitar
    await expect(
      adminCaller.megaadmin.addClientUser({
        clientId: testClientId,
        name: "Usuário Além do Limite",
        email: "alem@limite.com",
        role: "agent",
      }),
    ).rejects.toThrow();
  });
});
