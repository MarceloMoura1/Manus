import { describe, it, expect, vi, beforeEach } from "vitest";
import * as pipelineRepo from "./modules/crm/pipeline/repository";
import * as db from "./db";

vi.mock("./db", () => ({
  getPool: vi.fn(),
}));

describe("MegaDesk CRM — Etapa 2B.4: Concorrência na Criação do Funil Padrão (ensureDefaultPipeline)", () => {
  const clientId = "tenant-concurrency-test";

  let mockConnection: {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  let mockPool: {
    getConnection: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ insertId: 10, affectedRows: 1 }]),
      query: vi.fn().mockResolvedValue([[]]),
    };

    mockPool = {
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      execute: vi.fn().mockResolvedValue([[]]),
      query: vi.fn().mockResolvedValue([[]]),
    };

    vi.mocked(db.getPool).mockReturnValue(mockPool as any);
  });

  it("recupera com segurança e retorna o funil criado pela thread vencedora ao colidir em ER_DUP_ENTRY no índice uq_mcp_tenant_default", async () => {
    // 1. Fast check outside transaction returns empty (both threads see nothing initially)
    mockPool.query.mockResolvedValueOnce([[]]);

    // 2. Inside transaction, SELECT FOR UPDATE also returns empty (both threads entered before commit)
    mockConnection.query.mockResolvedValueOnce([[]]);

    // 3. INSERT into megadesk_crm_pipelines fails with ER_DUP_ENTRY on uq_mcp_tenant_default
    const dupError: any = new Error("Duplicate entry 'tenant-concurrency-test-1' for key 'uq_mcp_tenant_default'");
    dupError.code = "ER_DUP_ENTRY";
    dupError.sqlMessage = "Duplicate entry 'tenant-concurrency-test-1' for key 'uq_mcp_tenant_default'";
    mockConnection.execute.mockRejectedValueOnce(dupError);

    // 4. Fallback re-query on pool for the default pipeline created by the winning thread
    const winningCreatedAt = new Date("2026-10-19T20:00:00Z");
    mockPool.query.mockResolvedValueOnce([
      [
        {
          id: 55,
          public_id: "pipe-winner-uuid",
          name: "Funil de Vendas Padrão",
          is_default: 1,
          display_order: 0,
          is_active: 1,
          created_at: winningCreatedAt,
          updated_at: winningCreatedAt,
        },
      ],
    ]);

    // 5. Fallback query for the stages of that pipeline
    mockPool.query.mockResolvedValueOnce([
      [
        {
          id: 1,
          public_id: "s-1",
          pipeline_id: 55,
          name: "Qualificação",
          display_order: 0,
          probability_pct: 20,
          color: "#3B82F6",
          sla_days: 3,
          created_at: winningCreatedAt,
          updated_at: winningCreatedAt,
        },
        {
          id: 5,
          public_id: "s-5",
          pipeline_id: 55,
          name: "Perdido",
          display_order: 4,
          probability_pct: 0,
          color: "#EF4444",
          sla_days: null,
          created_at: winningCreatedAt,
          updated_at: winningCreatedAt,
        },
      ],
    ]);

    const result = await pipelineRepo.ensureDefaultPipeline(clientId);

    expect(result).toBeDefined();
    expect(result.publicId).toBe("pipe-winner-uuid");
    expect(result.name).toBe("Funil de Vendas Padrão");
    expect(result.isDefault).toBe(true);
    expect(result.stages).toHaveLength(2);

    // Transaction must have rolled back and released
    expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });

  it("propaga o erro original se a consulta de recuperação posterior não encontrar o funil padrão", async () => {
    // 1. Fast check outside transaction returns empty
    mockPool.query.mockResolvedValueOnce([[]]);

    // 2. SELECT FOR UPDATE inside transaction returns empty
    mockConnection.query.mockResolvedValueOnce([[]]);

    // 3. INSERT fails with ER_DUP_ENTRY
    const dupError: any = new Error("Duplicate entry 'tenant-concurrency-test-1' for key 'uq_mcp_tenant_default'");
    dupError.code = "ER_DUP_ENTRY";
    dupError.sqlMessage = "Duplicate entry 'tenant-concurrency-test-1' for key 'uq_mcp_tenant_default'";
    mockConnection.execute.mockRejectedValueOnce(dupError);

    // 4. Fallback re-query returns empty (unexpected disappearance / winning transaction rolled back)
    mockPool.query.mockResolvedValueOnce([[]]);

    await expect(pipelineRepo.ensureDefaultPipeline(clientId)).rejects.toThrow(
      "Duplicate entry 'tenant-concurrency-test-1' for key 'uq_mcp_tenant_default'"
    );

    expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  it("propaga imediatamente erros não relacionados à constraint uq_mcp_tenant_default (ex: falha de rede ou deadlock)", async () => {
    // 1. Fast check outside transaction returns empty
    mockPool.query.mockResolvedValueOnce([[]]);

    // 2. SELECT FOR UPDATE inside transaction returns empty
    mockConnection.query.mockResolvedValueOnce([[]]);

    // 3. Network or other constraint failure
    const networkError: any = new Error("ECONNRESET: Connection lost to MySQL server");
    networkError.code = "ECONNRESET";
    mockConnection.execute.mockRejectedValueOnce(networkError);

    await expect(pipelineRepo.ensureDefaultPipeline(clientId)).rejects.toThrow("ECONNRESET");

    // Must NOT have executed fallback query on pool
    expect(mockPool.query).toHaveBeenCalledTimes(1); // only the initial fast check
    expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });
});
