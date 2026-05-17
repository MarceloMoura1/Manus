import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

const mockReq = { headers: {}, cookies: {} } as any;
const mockRes = { cookie: () => {}, clearCookie: () => {} } as any;
const publicCaller = appRouter.createCaller({ req: mockReq, res: mockRes, user: null });
const adminCaller = appRouter.createCaller({ req: mockReq, res: mockRes, user: { openId: "owner-open-id", name: "Admin MegaDesk", role: "admin" } as any });
const userCaller = appRouter.createCaller({ req: mockReq, res: mockRes, user: { openId: "user-open-id", name: "Usuário padrão", role: "user" } as any });

describe("MegaDesk platform", () => {
  it("bloqueia procedures sensíveis do MegaAdmin para usuários não administradores", async () => {
    await expect(userCaller.megaadmin.summary()).rejects.toThrow();
    await expect(userCaller.megaadmin.createClient({ company: "Cliente Bloqueado", contact: "Teste", phone: "551199998888", plan: "Teste" })).rejects.toThrow();
  });

  it("sincroniza alterações do MegaAdmin para a MegaDesk no mesmo backend", async () => {
    const created = await adminCaller.megaadmin.createClient({ company: "Cliente Sincronizado", contact: "Patricia Silva", email: "patricia@clientesincronizado.com", phone: "551188887777", plan: "WhatsApp Premium" });
    expect(created.integrationToken).toMatch(/^mdsk_live_/);

    await adminCaller.megaadmin.updateClientAccess({ clientId: created.client.clientId, status: "active", accessReleased: true });

    const addedUser = await adminCaller.megaadmin.addClientUser({ clientId: created.client.clientId, name: "Operador Temporário", email: "temporario@cliente.com", role: "agent" });
    // agent deve ter atendimento_ativo, conversas, chamados
    expect(addedUser.user.permissions).toContain("atendimento_ativo");
    expect(addedUser.user.permissions).toContain("conversas");
    expect(addedUser.user.permissions).toContain("chamados");

    const updatedUser = await adminCaller.megaadmin.updateClientUser({ clientId: created.client.clientId, userId: addedUser.user.id, role: "viewer" });
    // viewer deve ter apenas chamados (além de home/settings/notifications)
    expect(updatedUser.user.permissions).toContain("chamados");
    expect(updatedUser.user.permissions).not.toContain("erp");
    expect(updatedUser.user.permissions).not.toContain("rastreio");

    await adminCaller.megaadmin.toggleModule({ clientId: created.client.clientId, module: "configurar_bot", enabled: true });

    const removedUser = await adminCaller.megaadmin.removeClientUser({ clientId: created.client.clientId, userId: addedUser.user.id });
    expect(removedUser.removedUserId).toBe(addedUser.user.id);

    await expect(adminCaller.megaadmin.removeClientUser({ clientId: created.client.clientId, userId: created.client.users[0].id })).rejects.toThrow("pelo menos um usuário");

    await adminCaller.megaadmin.toggleModule({ clientId: created.client.clientId, module: "chamados", enabled: true });
    await adminCaller.megaadmin.pushOperationalRecord({ clientId: created.client.clientId, type: "ticket", ownerPhone: "551188887777", title: "Chamado criado pelo MegaAdmin", status: "open", payload: { description: "Registro compartilhado" } });

    const validation = await publicCaller.megadesk.validateToken({ clientId: created.client.clientId, token: created.integrationToken, userEmail: created.client.users[0].email });
    expect(validation.ok).toBe(true);
    expect(validation.modules).toContain("chamados");

    const overview = await publicCaller.megadesk.overview({ clientId: created.client.clientId, userEmail: created.client.users[0].email });
    expect(overview.tenant.nome).toBe("Cliente Sincronizado");
    expect(overview.tickets.some((ticket) => ticket.problem === "Chamado criado pelo MegaAdmin")).toBe(true);

    const observability = await publicCaller.megadesk.tenantObservability({ clientId: created.client.clientId, userEmail: created.client.users[0].email });
    expect(observability.clientId).toBe(created.client.clientId);
    expect(Array.isArray(observability.observability.metrics)).toBe(true);
    expect(Array.isArray(observability.observability.auditLogs)).toBe(true);
    expect(Array.isArray(observability.observability.botScripts)).toBe(true);
    expect(observability.observability.auditLogs.every((log) => log.action)).toBe(true);

    const adminObservability = await adminCaller.megaadmin.tenantObservability({ clientId: created.client.clientId });
    expect(adminObservability.client.clientId).toBe(created.client.clientId);
  }, 30_000);
});

describe("MegaDesk login por e-mail", () => {
  it("autentica usuário ativo com e-mail e senha cadastrados e retorna sessão", async () => {
    // Cria cliente — usuário inicial tem status=blocked
    const created = await adminCaller.megaadmin.createClient({ company: "Empresa Login Test", contact: "Operador Login", email: "operador@logintest.com", phone: "551199990001", plan: "Teste" });
    // Libera acesso ao cliente e ativa o status
    await adminCaller.megaadmin.updateClientAccess({ clientId: created.client.clientId, status: "active", accessReleased: true });
    // Ativa o usuário admin criado automaticamente (status inicial = blocked)
    await adminCaller.megaadmin.updateClientUser({ clientId: created.client.clientId, userId: created.client.users[0].id, status: "active" });
    // Define a senha do usuário via resetUserPassword (grava hash no banco)
    await adminCaller.megaadmin.resetUserPassword({ clientId: created.client.clientId, userId: created.client.users[0].id, newPassword: "senha123" });
    // Login deve funcionar agora
    const result = await publicCaller.megadesk.loginByEmail({ email: "operador@logintest.com", password: "senha123" });
    expect(result.session.userEmail).toBe("operador@logintest.com");
    expect(result.session.clientId).toBe(created.client.clientId);
    expect(result.session.userName).toBeTruthy();
    expect(result.session.company).toBeTruthy();
    // home, settings e notifications são sempre concedidos a qualquer role
    expect(result.session.permissions).toContain("home");
    expect(result.session.permissions).toContain("settings");
    expect(result.session.permissions).toContain("notifications");
    // admin deve ter todos os módulos
    expect(result.session.permissions).toContain("atendimento_ativo");
    expect(result.session.permissions).toContain("chamados");
  }, 30_000);

  it("rejeita e-mail não cadastrado", async () => {
    await expect(
      publicCaller.megadesk.loginByEmail({ email: "naoexiste@dominio.com", password: "qualquer" })
    ).rejects.toThrow();
  });

  it("rejeita usuário de cliente sem acesso liberado", async () => {
    const created = await adminCaller.megaadmin.createClient({
      company: "Cliente Bloqueado Login",
      contact: "Teste Bloqueado",
      email: "bloqueado-admin@cliente.com",
      phone: "551177776666",
      plan: "Básico",
    });
    const addedUser = await adminCaller.megaadmin.addClientUser({
      clientId: created.client.clientId,
      name: "Usuário Bloqueado",
      email: "bloqueado@cliente.com",
      role: "agent",
    });
    await expect(
      publicCaller.megadesk.loginByEmail({ email: addedUser.user.email, password: "qualquer" })
    ).rejects.toThrow();
  });
});

describe("MegaAdmin login próprio", () => {
  it("autentica com e-mail e senha corretos e retorna ok", async () => {
    // Usa publicCaller pois loginAdmin é publicProcedure
    const result = await publicCaller.megaadmin.loginAdmin({
      email: "marcelo.mouraadmpro@gmail.com",
      password: "123456",
    });
    expect(result.ok).toBe(true);
    expect(result.name).toBeTruthy();
    expect(result.email).toBe("marcelo.mouraadmpro@gmail.com");
  });

  it("rejeita e-mail inexistente", async () => {
    await expect(
      publicCaller.megaadmin.loginAdmin({
        email: "naoexiste@exemplo.com",
        password: "qualquersenha",
      })
    ).rejects.toThrow();
  });

  it("rejeita senha incorreta", async () => {
    await expect(
      publicCaller.megaadmin.loginAdmin({
        email: "marcelo.mouraadmpro@gmail.com",
        password: "senhaerrada",
      })
    ).rejects.toThrow();
  });

  it("logoutAdmin limpa a sessão e retorna ok", async () => {
    const result = await publicCaller.megaadmin.logoutAdmin();
    expect(result.ok).toBe(true);
  });
});
