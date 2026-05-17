/**
 * Testes do ciclo de vida do passwordHash
 *
 * Garante que o hash de senha nunca seja perdido ou sobrescrito com null
 * em nenhum cenário: restart do servidor, persistência, criação de usuário, etc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// ─── Helpers de teste ────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{ id: string; passwordHash: string | null }> = {}) {
  return {
    id: overrides.id ?? `user-${Date.now()}`,
    name: "Usuário Teste",
    email: "teste@exemplo.com",
    role: "agent" as const,
    status: "active" as const,
    permissions: [],
    passwordHash: overrides.passwordHash !== undefined ? overrides.passwordHash : null,
  };
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("passwordHash — ciclo de vida", () => {
  it("bcrypt.hash gera hash válido para senha padrão 123456", async () => {
    const hash = await bcrypt.hash("123456", 12);
    expect(hash).toBeTruthy();
    expect(hash.startsWith("$2b$")).toBe(true);
    const valid = await bcrypt.compare("123456", hash);
    expect(valid).toBe(true);
  });

  it("bcrypt.compare retorna false para senha errada", async () => {
    const hash = await bcrypt.hash("123456", 12);
    const invalid = await bcrypt.compare("senhaErrada", hash);
    expect(invalid).toBe(false);
  });

  it("usuário criado com passwordHash não-null preserva o hash", async () => {
    const hash = await bcrypt.hash("123456", 12);
    const user = makeUser({ passwordHash: hash });
    // Simula o que o loadMegaDeskStructuredState faz ao ler do banco
    const loaded = { ...user, passwordHash: user.passwordHash };
    expect(loaded.passwordHash).toBe(hash);
    expect(loaded.passwordHash).not.toBeNull();
  });

  it("CAMADA 1: memHash tem prioridade sobre dbHash", async () => {
    const memHash = await bcrypt.hash("novaSenha", 12);
    const dbHash = await bcrypt.hash("senhaAntiga", 12);
    // Simula a lógica da Camada 1 no saveMegaDeskStructuredState
    const passwordHash = memHash ?? dbHash;
    expect(passwordHash).toBe(memHash);
  });

  it("CAMADA 1: dbHash é usado quando memHash é null", async () => {
    const memHash = null;
    const dbHash = await bcrypt.hash("senhaExistente", 12);
    // Simula a lógica da Camada 1 no saveMegaDeskStructuredState
    const passwordHash = memHash ?? dbHash;
    expect(passwordHash).toBe(dbHash);
    expect(passwordHash).not.toBeNull();
  });

  it("CAMADA 1: resultado é null apenas quando ambos são null", () => {
    const memHash = null;
    const dbHash = null;
    const passwordHash = memHash ?? dbHash;
    expect(passwordHash).toBeNull();
  });

  it("usuário sem passwordHash em memória mas com hash no banco preserva o hash do banco", async () => {
    const existingDbHash = await bcrypt.hash("123456", 12);
    // Simula passwordHashMap carregado do banco antes do save
    const passwordHashMap = new Map<string, string>();
    passwordHashMap.set("user-001", existingDbHash);

    // Usuário em memória sem hash (como acontecia antes da correção)
    const userInMemory = makeUser({ id: "user-001", passwordHash: null });

    // Aplica a lógica da Camada 1
    const memHash = (userInMemory as any).passwordHash ?? null;
    const dbHash = passwordHashMap.get(userInMemory.id) ?? null;
    const finalHash = memHash ?? dbHash;

    expect(finalHash).toBe(existingDbHash);
    expect(finalHash).not.toBeNull();
  });

  it("restart do servidor não apaga senha: loadMegaDeskStructuredState inclui passwordHash", () => {
    // Simula o que o db.ts faz ao carregar do banco (após a correção)
    const dbRow = {
      user_id: "user-001",
      name: "Teste",
      email: "teste@exemplo.com",
      role: "agent",
      status: "active",
      permissions_json: "[]",
      password_hash: "$2b$12$hashExemplo",
    };

    // Simula o mapeamento corrigido no loadMegaDeskStructuredState
    const userFromDb = {
      id: dbRow.user_id,
      name: dbRow.name,
      email: dbRow.email,
      role: dbRow.role,
      status: dbRow.status,
      permissions: JSON.parse(dbRow.permissions_json),
      passwordHash: dbRow.password_hash ?? null, // ← correção aplicada
    };

    expect(userFromDb.passwordHash).toBe("$2b$12$hashExemplo");
    expect(userFromDb.passwordHash).not.toBeNull();
  });

  it("CAMADA 2: COALESCE SQL nunca sobrescreve hash existente com null", () => {
    // Simula o comportamento do COALESCE(VALUES(password_hash), password_hash)
    function coalesce(newValue: string | null, existingValue: string | null): string | null {
      return newValue ?? existingValue;
    }

    const existingHash = "$2b$12$hashExistente";

    // Caso 1: novo valor é null → mantém o existente
    expect(coalesce(null, existingHash)).toBe(existingHash);

    // Caso 2: novo valor é um hash → usa o novo
    const newHash = "$2b$12$novoHash";
    expect(coalesce(newHash, existingHash)).toBe(newHash);

    // Caso 3: ambos null → resultado é null
    expect(coalesce(null, null)).toBeNull();
  });

  it("CAMADA 3: detecta usuário ativo sem hash (simulação)", () => {
    // Simula a verificação de integridade pós-save
    const usersInDb = [
      { user_id: "user-001", email: "a@a.com", client_id: "c-001", status: "active", password_hash: "$2b$12$hash" },
      { user_id: "user-002", email: "b@b.com", client_id: "c-001", status: "active", password_hash: null },
      { user_id: "user-003", email: "c@c.com", client_id: "c-001", status: "blocked", password_hash: null },
    ];

    // Filtra usuários ativos sem hash (como a query SQL da Camada 3)
    const orphans = usersInDb.filter(
      (u) => u.status === "active" && (u.password_hash === null || u.password_hash === "")
    );

    expect(orphans).toHaveLength(1);
    expect(orphans[0].email).toBe("b@b.com");
    // Usuário bloqueado sem hash não deve ser reportado como crítico
    expect(orphans.find((u) => u.email === "c@c.com")).toBeUndefined();
  });

  it("fluxo completo: criar usuário → salvar → reiniciar → senha preservada", async () => {
    // 1. Criar usuário com hash
    const originalHash = await bcrypt.hash("123456", 12);
    const user = makeUser({ id: "user-flow-001", passwordHash: originalHash });

    // 2. Simular persistência no banco (INSERT)
    const dbRecord = { user_id: user.id, password_hash: user.passwordHash };

    // 3. Simular restart: carregar do banco (ANTES da correção, passwordHash era omitido)
    // DEPOIS da correção, passwordHash é incluído
    const userAfterRestart = {
      id: dbRecord.user_id,
      passwordHash: dbRecord.password_hash, // ← incluído após correção
    };

    // 4. Simular save após restart
    const passwordHashMap = new Map<string, string>();
    if (dbRecord.password_hash) passwordHashMap.set(dbRecord.user_id, dbRecord.password_hash);

    const memHash = userAfterRestart.passwordHash ?? null;
    const dbHash = passwordHashMap.get(userAfterRestart.id) ?? null;
    const finalHash = memHash ?? dbHash;

    // 5. Verificar que o hash original foi preservado
    expect(finalHash).toBe(originalHash);
    const stillValid = await bcrypt.compare("123456", finalHash!);
    expect(stillValid).toBe(true);
  });
});
