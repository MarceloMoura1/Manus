import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { isTestDatabaseEnabled } from "./test-integration-gates";
import { MEGAADMIN_COOKIE, type TrpcContext } from "./_core/context";
const integrationIt = it.runIf(isTestDatabaseEnabled());
const integrationDescribe = describe.runIf(isTestDatabaseEnabled());

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

  integrationIt("sincroniza alterações do MegaAdmin para a MegaDesk no mesmo backend", async () => {
    const created = await adminCaller.megaadmin.createClient({ company: "Cliente Sincronizado", contact: "Patricia Silva", email: "patricia@clientesincronizado.com", phone: "551188887777", plan: "WhatsApp Premium", idempotencyKey: "platform-synchronized-client-001" });
    expect(created.integrationToken).toMatch(/^mdsk_live_/);

    await adminCaller.megaadmin.reactivateClient({ clientId: created.client.clientId });
    await adminCaller.megaadmin.releaseClientAccess({ clientId: created.client.clientId });
    await adminCaller.megaadmin.updateClientUser({ clientId: created.client.clientId, userId: created.client.users[0].id, status: "active" });

    const addedUser = await adminCaller.megaadmin.addClientUser({ clientId: created.client.clientId, name: "Operador Temporário", email: "temporario@cliente.com", role: "agent" });
    // O backend usa os identificadores canônicos com hífen.
    expect(addedUser.user.permissions).toContain("active-attendance");
    expect(addedUser.user.permissions).toContain("conversations");
    expect(addedUser.user.permissions).toContain("tickets");

    const updatedUser = await adminCaller.megaadmin.updateClientUser({ clientId: created.client.clientId, userId: addedUser.user.id, role: "viewer" });
    // viewer deve ter apenas chamados (além de home/settings/notifications)
    expect(updatedUser.user.permissions).toContain("tickets");
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

    const tenantCaller = appRouter.createCaller({
      req: mockReq,
      res: mockRes,
      user: null,
      tenantId: created.client.clientId,
      userEmail: created.client.users[0].email,
      operationalUserId: created.client.users[0].id,
      operationalUserRole: "admin",
    });
    const overview = await tenantCaller.megadesk.overview({ clientId: created.client.clientId, userEmail: created.client.users[0].email });
    expect(overview.tenant.nome).toBe("Cliente Sincronizado");
    expect(overview.tickets.some((ticket) => ticket.problem === "Chamado criado pelo MegaAdmin")).toBe(true);

    const observability = await tenantCaller.megadesk.tenantObservability({ clientId: created.client.clientId, userEmail: created.client.users[0].email });
    expect(observability.clientId).toBe(created.client.clientId);
    expect(Array.isArray(observability.observability.metrics)).toBe(true);
    expect(Array.isArray(observability.observability.auditLogs)).toBe(true);
    expect(Array.isArray(observability.observability.botScripts)).toBe(true);
    expect(observability.observability.auditLogs.every((log) => log.action)).toBe(true);

    const adminObservability = await adminCaller.megaadmin.tenantObservability({ clientId: created.client.clientId });
    expect(adminObservability.client.clientId).toBe(created.client.clientId);
  }, 30_000);
});

integrationDescribe("MegaDesk login por e-mail", () => {
  it("autentica usuário ativo com e-mail e senha cadastrados e retorna sessão", async () => {
    // Cria cliente — usuário inicial tem status=blocked
    const created = await adminCaller.megaadmin.createClient({ company: "Empresa Login Test", contact: "Operador Login", email: "operador@logintest.com", phone: "551199990001", plan: "Teste", idempotencyKey: "platform-login-client-001" });
    // Libera acesso ao cliente e ativa o status
    await adminCaller.megaadmin.reactivateClient({ clientId: created.client.clientId });
    await adminCaller.megaadmin.releaseClientAccess({ clientId: created.client.clientId });
    // Ativa o usuário admin criado automaticamente (status inicial = blocked)
    await adminCaller.megaadmin.updateClientUser({ clientId: created.client.clientId, userId: created.client.users[0].id, status: "active" });
    // Define a senha do usuário via resetUserPassword (grava hash no banco)
    await adminCaller.megaadmin.resetUserPassword({ clientId: created.client.clientId, userId: created.client.users[0].id, newPassword: "senha123" });
    // Login deve funcionar agora
    const result = await publicCaller.megadesk.loginByEmail({ companyId: created.client.clientId, email: "operador@logintest.com", password: "senha123" });
    expect(result.session.userEmail).toBe("operador@logintest.com");
    expect(result.session.clientId).toBe(created.client.clientId);
    expect(result.session.userName).toBeTruthy();
    expect(result.session.company).toBeTruthy();
    // home, settings e notifications são sempre concedidos a qualquer role
    expect(result.session.permissions).toContain("home");
    expect(result.session.permissions).toContain("settings");
    expect(result.session.permissions).toContain("notifications");
    // admin deve ter todos os módulos
    expect(result.session.permissions).toContain("active-attendance");
    expect(result.session.permissions).toContain("tickets");
  }, 30_000);

  it("rejeita e-mail não cadastrado", async () => {
    await expect(
      publicCaller.megadesk.loginByEmail({ companyId: "cliente-inexistente", email: "naoexiste@dominio.com", password: "qualquer" })
    ).rejects.toThrow();
  });

  it("rejeita usuário de cliente sem acesso liberado", async () => {
    const created = await adminCaller.megaadmin.createClient({
      company: "Cliente Bloqueado Login",
      contact: "Teste Bloqueado",
      email: "bloqueado-admin@cliente.com",
      phone: "551177776666",
      plan: "Básico",
      idempotencyKey: "platform-blocked-client-001",
    });
    const addedUser = await adminCaller.megaadmin.addClientUser({
      clientId: created.client.clientId,
      name: "Usuário Bloqueado",
      email: "bloqueado@cliente.com",
      role: "agent",
    });
    await expect(
      publicCaller.megadesk.loginByEmail({ companyId: created.client.clientId, email: addedUser.user.email, password: "qualquer" })
    ).rejects.toThrow();
  });

  it("isola o mesmo e-mail e senhas diferentes em dois tenants", async () => {
    const sharedEmail = "shared-login@example.invalid";
    const first = await adminCaller.megaadmin.createClient({ company: "Tenant Login A", contact: "Admin A", email: "tenant-login-a@example.invalid", phone: "551199990101", plan: "Teste", idempotencyKey: "platform-login-tenant-a-001" });
    const second = await adminCaller.megaadmin.createClient({ company: "Tenant Login B", contact: "Admin B", email: "tenant-login-b@example.invalid", phone: "551199990102", plan: "Teste", idempotencyKey: "platform-login-tenant-b-001" });
    for (const created of [first, second]) {
      await adminCaller.megaadmin.reactivateClient({ clientId: created.client.clientId });
      await adminCaller.megaadmin.releaseClientAccess({ clientId: created.client.clientId });
    }
    const userA = await adminCaller.megaadmin.addClientUser({ clientId: first.client.clientId, name: "Shared A", email: sharedEmail, role: "agent" });
    const userB = await adminCaller.megaadmin.addClientUser({ clientId: second.client.clientId, name: "Shared B", email: sharedEmail, role: "agent" });
    await adminCaller.megaadmin.updateClientUser({ clientId: first.client.clientId, userId: userA.user.id, status: "active" });
    await adminCaller.megaadmin.updateClientUser({ clientId: second.client.clientId, userId: userB.user.id, status: "active" });
    await adminCaller.megaadmin.resetUserPassword({ clientId: first.client.clientId, userId: userA.user.id, newPassword: "senha-tenant-a" });
    await adminCaller.megaadmin.resetUserPassword({ clientId: second.client.clientId, userId: userB.user.id, newPassword: "senha-tenant-b" });

    const loginA = await publicCaller.megadesk.loginByEmail({ companyId: first.client.clientId, email: sharedEmail.toUpperCase(), password: "senha-tenant-a" });
    const loginB = await publicCaller.megadesk.loginByEmail({ companyId: ` ${second.client.clientId.toUpperCase()} `, email: ` ${sharedEmail} `, password: "senha-tenant-b" });
    expect(loginA.session.clientId).toBe(first.client.clientId);
    expect(loginB.session.clientId).toBe(second.client.clientId);
    await expect(publicCaller.megadesk.loginByEmail({ companyId: first.client.clientId, email: sharedEmail, password: "senha-tenant-b" })).rejects.toThrow("Empresa, e-mail ou senha inválidos");
    await expect(publicCaller.megadesk.loginByEmail({ companyId: second.client.clientId, email: sharedEmail, password: "senha-tenant-a" })).rejects.toThrow("Empresa, e-mail ou senha inválidos");
  }, 30_000);
});

describe("MegaAdmin login próprio", () => {
  integrationIt("não cria credencial administrativa implicitamente em banco limpo", async () => {
    // Usa publicCaller pois loginAdmin é publicProcedure
    await expect(publicCaller.megaadmin.loginAdmin({
      email: "marcelo.mouraadmpro@gmail.com",
      password: "123456",
    })).rejects.toThrow();
  });

  integrationIt("rejeita e-mail inexistente", async () => {
    await expect(
      publicCaller.megaadmin.loginAdmin({
        email: "naoexiste@exemplo.com",
        password: "qualquersenha",
      })
    ).rejects.toThrow();
  });

  integrationIt("rejeita senha incorreta", async () => {
    await expect(
      publicCaller.megaadmin.loginAdmin({
        email: "marcelo.mouraadmpro@gmail.com",
        password: "senhaerrada",
      })
    ).rejects.toThrow();
  });

  it.each([
    { protocol: "http", headers: {}, secure: false },
    { protocol: "https", headers: {}, secure: true },
    { protocol: "http", headers: { "x-forwarded-proto": "https" }, secure: true },
  ])("logoutAdmin limpa somente o cookie administrativo em $protocol", async ({ protocol, headers, secure }) => {
    const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
    const caller = appRouter.createCaller({
      req: { protocol, headers } as TrpcContext["req"],
      res: { clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }) } as TrpcContext["res"],
      user: null,
    });
    const result = await caller.megaadmin.logoutAdmin();
    expect(result.ok).toBe(true);
    expect(cleared).toEqual([{
      name: MEGAADMIN_COOKIE,
      options: { httpOnly: true, path: "/", sameSite: "none", secure, maxAge: -1 },
    }]);
  });
});
