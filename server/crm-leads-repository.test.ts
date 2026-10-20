import { describe, it, expect, vi, beforeEach } from "vitest";
import * as repo from "./modules/crm/leads/repository";
import * as db from "./db";
import * as dbCrm from "./db-crm";

vi.mock("./db", () => ({
  getPool: vi.fn(),
}));

vi.mock("./db-crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db-crm")>();
  return {
    ...actual,
    addCrmTimeline: vi.fn(),
  };
});

describe("MegaDesk CRM — Etapa 2B.3: Atomicidade Transacional e Concorrência do Repositório", () => {
  const clientId = "tenant-repo-test";
  const actor = "Operador Transacional";

  let mockConnection: {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    vi.mocked(db.getPool).mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      execute: vi.fn().mockResolvedValue([[]]),
    } as any);
  });

  describe("createLead", () => {
    it("executa INSERT e addCrmTimeline na mesma transação e faz commit", async () => {
      vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

      const result = await repo.createLead(
        clientId,
        {
          companyName: "Empresa Transacional Ltda",
          customerType: "company",
          phone: "11988887777",
          origin: "site",
          responsibleName: "Diretor",
          cpfCnpj: "",
          whatsapp: "",
          email: "",
          internalResponsible: "",
          tags: "",
          observations: "",
          contacts: [],
        },
        actor
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_crm_clients"),
        expect.any(Array)
      );
      expect(dbCrm.addCrmTimeline).toHaveBeenCalledWith(
        result.crmClientId,
        clientId,
        expect.objectContaining({ type: "note" }),
        mockConnection
      );
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("faz rollback e libera conexão se a inclusão da timeline falhar durante a criação", async () => {
      vi.mocked(dbCrm.addCrmTimeline).mockRejectedValue(new Error("Falha ao gravar evento de timeline"));

      await expect(
        repo.createLead(
          clientId,
          {
            companyName: "Empresa Falha Timeline",
            customerType: "company",
            phone: "",
            origin: "outro",
            responsibleName: "",
            cpfCnpj: "",
            whatsapp: "",
            email: "",
            internalResponsible: "",
            tags: "",
            observations: "",
            contacts: [],
          },
          actor
        )
      ).rejects.toThrowError("Falha ao gravar evento de timeline");

      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe("convertLeadToClient", () => {
    it("executa SELECT FOR UPDATE, UPDATE condicional e addCrmTimeline na mesma transação com commit", async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[{ crm_client_id: "crm-lead-ok", company_name: "Empresa Alvo", status: "lead" }]]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE ... AND status = 'lead'
      vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

      const result = await repo.convertLeadToClient(
        clientId,
        {
          crmClientId: "crm-lead-ok",
          notes: "Qualificado e fechado",
        },
        actor
      );

      expect(result.crmClientId).toBe("crm-lead-ok");
      expect(result.companyName).toBe("Empresa Alvo");
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("FOR UPDATE"),
        [clientId, "crm-lead-ok"]
      );
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND status = 'lead'"),
        expect.any(Array)
      );
      expect(dbCrm.addCrmTimeline).toHaveBeenCalledWith(
        "crm-lead-ok",
        clientId,
        expect.objectContaining({ type: "status_change" }),
        mockConnection
      );
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("bloqueia e faz rollback se o lead já tiver status ativo", async () => {
      mockConnection.execute.mockResolvedValueOnce([
        [{ crm_client_id: "crm-lead-ativo", company_name: "Empresa Já Ativa", status: "ativo" }],
      ]);

      await expect(
        repo.convertLeadToClient(
          clientId,
          { crmClientId: "crm-lead-ativo" },
          actor
        )
      ).rejects.toThrowError("Este lead já foi convertido em cliente ativo.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("bloqueia e faz rollback se o status do cadastro não for lead nem ativo (ex: inativo ou cancelado)", async () => {
      mockConnection.execute.mockResolvedValueOnce([
        [{ crm_client_id: "crm-lead-canc", company_name: "Empresa Cancelada", status: "cancelado" }],
      ]);

      await expect(
        repo.convertLeadToClient(
          clientId,
          { crmClientId: "crm-lead-canc" },
          actor
        )
      ).rejects.toThrowError("Este lead não pode ser convertido pois está com status 'cancelado'.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("rejeita conversão concorrente quando affectedRows for 0 e faz rollback", async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[{ crm_client_id: "crm-lead-race", company_name: "Empresa Concorrente", status: "lead" }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }]); // Outra transação alterou o status milissegundos antes

      await expect(
        repo.convertLeadToClient(
          clientId,
          { crmClientId: "crm-lead-race" },
          actor
        )
      ).rejects.toThrowError("Falha na conversão concorrente do lead. O status já foi alterado por outra requisição.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("faz rollback da conversão se a inclusão da timeline falhar", async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[{ crm_client_id: "crm-lead-tfail", company_name: "Empresa Rollback", status: "lead" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      vi.mocked(dbCrm.addCrmTimeline).mockRejectedValue(new Error("Erro ao gravar nota na timeline"));

      await expect(
        repo.convertLeadToClient(
          clientId,
          { crmClientId: "crm-lead-tfail" },
          actor
        )
      ).rejects.toThrowError("Erro ao gravar nota na timeline");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });
  });
});
