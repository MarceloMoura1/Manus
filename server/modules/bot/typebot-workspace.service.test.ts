import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  typebotWorkspaceService,
  generateCuid,
  createDefaultTypebotTemplate,
} from "./typebot-workspace.service";

describe("Typebot Workspace Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateCuid", () => {
    it("deve gerar identificadores válidos com prefixo customizável", () => {
      const id1 = generateCuid("w");
      const id2 = generateCuid("w");
      expect(id1.startsWith("w")).toBe(true);
      expect(id2.startsWith("w")).toBe(true);
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeLessThanOrEqual(25);
    });
  });

  describe("createDefaultTypebotTemplate", () => {
    it("deve conter versão 6.1 e nós de boas-vindas e transferência humana", () => {
      const template = createDefaultTypebotTemplate();
      expect(template.version).toBe("6.1");
      expect(template.groups).toHaveLength(2);
      expect(template.groups[0].title).toBe("Boas-vindas");
      expect(template.groups[1].title).toBe("Transferência Humana");
      expect(template.events).toHaveLength(1);
      expect(template.events[0].type).toBe("start");
      expect(template.edges).toHaveLength(2);
    });
  });

  describe("getOrCreateClientWorkspace", () => {
    it("deve rejeitar se clientId estiver ausente", async () => {
      await expect(
        typebotWorkspaceService.getOrCreateClientWorkspace("", "Empresa X", "admin@teste.com")
      ).rejects.toThrow("clientId é obrigatório");
    });

    it("deve criar novo usuário, workspace, membro, template e sessão quando não existirem", async () => {
      const executedQueries: { text: string; values?: any[] }[] = [];

      const mockClient = {
        query: vi.fn(async (text: string, values?: any[]) => {
          executedQueries.push({ text, values });

          // 1. SELECT User -> não encontrado
          if (text.includes('SELECT id, name FROM "User"')) {
            return { rows: [] };
          }
          // 2. SELECT Workspace -> não encontrado
          if (text.includes('SELECT id, name FROM "Workspace"')) {
            return { rows: [] };
          }
          // 3. SELECT MemberInWorkspace -> não encontrado
          if (text.includes('SELECT role FROM "MemberInWorkspace"')) {
            return { rows: [] };
          }
          // 4. SELECT Typebot -> não encontrado
          if (text.includes('SELECT id FROM "Typebot"')) {
            return { rows: [] };
          }

          return { rows: [] };
        }),
        release: vi.fn(),
      };

      const mockPool: any = {
        connect: vi.fn(async () => mockClient),
        on: vi.fn(),
      };

      typebotWorkspaceService.setPool(mockPool);

      const result = await typebotWorkspaceService.getOrCreateClientWorkspace(
        "tenant-123",
        "Oficina do Zé",
        "ze@oficina.com.br",
        "José Silva"
      );

      expect(result.workspaceId).toBeDefined();
      expect(result.workspaceName).toBe("MegaDesk - Oficina do Zé");
      expect(result.isNewWorkspace).toBe(true);
      expect(result.sessionToken).toBeDefined();
      expect(result.loginUrl).toContain(`/api/megadesk-login?token=${result.sessionToken}`);
      expect(result.directUrl).toContain(`/w/${result.workspaceId}/typebots`);

      // Verifica as operações SQL executadas
      const queryTexts = executedQueries.map((q) => q.text);
      expect(queryTexts).toContain("BEGIN");
      expect(queryTexts.some((t) => t.includes('INSERT INTO "User"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('INSERT INTO "Workspace"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('INSERT INTO "MemberInWorkspace"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('INSERT INTO "Typebot"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('INSERT INTO "Session"'))).toBe(true);
      expect(queryTexts).toContain("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("deve reaproveitar workspace existente se já estiver cadastrado", async () => {
      const mockClient = {
        query: vi.fn(async (text: string, values?: any[]) => {
          // 1. SELECT User -> já existe
          if (text.includes('SELECT id, name FROM "User"')) {
            return { rows: [{ id: "usr_existing_1", name: "Maria" }] };
          }
          // 2. SELECT Workspace -> já existe
          if (text.includes('SELECT id, name FROM "Workspace"')) {
            return { rows: [{ id: "ws_existing_99", name: "MegaDesk - Loja Maria" }] };
          }
          // 3. SELECT MemberInWorkspace -> já existe
          if (text.includes('SELECT role FROM "MemberInWorkspace"')) {
            return { rows: [{ role: "ADMIN" }] };
          }

          return { rows: [] };
        }),
        release: vi.fn(),
      };

      const mockPool: any = {
        connect: vi.fn(async () => mockClient),
        on: vi.fn(),
      };

      typebotWorkspaceService.setPool(mockPool);

      const result = await typebotWorkspaceService.getOrCreateClientWorkspace(
        "tenant-999",
        "Loja Maria",
        "maria@loja.com"
      );

      expect(result.workspaceId).toBe("ws_existing_99");
      expect(result.isNewWorkspace).toBe(false);
      expect(result.loginUrl).toContain("workspaceId=ws_existing_99");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});

