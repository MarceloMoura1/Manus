import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

// Schema para validação de duplicação
const ChamadoCreateSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  phone: z.string().regex(/^\d{10,15}$/),
  email: z.string().email().optional(),
  priority: z.enum(["baixa", "media", "alta", "critica"]),
});

type ChamadoCreate = z.infer<typeof ChamadoCreateSchema>;

// Simulação de banco de dados em memória para testes
let chamadosDb: (ChamadoCreate & { id: string; createdAt: Date })[] = [];

// Função para verificar duplicação
function checkDuplicateChamado(
  newChamado: ChamadoCreate,
  existingChamados: (ChamadoCreate & { id: string; createdAt: Date })[]
): {
  isDuplicate: boolean;
  reason?: string;
  existingChamadoId?: string;
} {
  // Verificar duplicação por cliente + título + telefone (mesmo dia)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const duplicate = existingChamados.find((chamado) => {
    const chamadoDate = new Date(chamado.createdAt);
    chamadoDate.setHours(0, 0, 0, 0);

    return (
      chamado.clientId === newChamado.clientId &&
      chamado.title.toLowerCase() === newChamado.title.toLowerCase() &&
      chamado.phone === newChamado.phone &&
      chamadoDate.getTime() === today.getTime()
    );
  });

  if (duplicate) {
    return {
      isDuplicate: true,
      reason: "Chamado duplicado: mesmo cliente, título e telefone no mesmo dia",
      existingChamadoId: duplicate.id,
    };
  }

  // Verificar duplicação por email (se fornecido)
  if (newChamado.email) {
    const duplicateByEmail = existingChamados.find(
      (chamado) =>
        chamado.email === newChamado.email &&
        chamado.clientId === newChamado.clientId
    );

    if (duplicateByEmail) {
      return {
        isDuplicate: true,
        reason: "Chamado duplicado: mesmo cliente e email",
        existingChamadoId: duplicateByEmail.id,
      };
    }
  }

  return { isDuplicate: false };
}

describe("Validação de Duplicação de Chamados", () => {
  beforeEach(() => {
    chamadosDb = [];
  });

  it("deve permitir criar chamado sem duplicação", () => {
    const newChamado: ChamadoCreate = {
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      email: "user@example.com",
      priority: "alta",
    };

    const result = checkDuplicateChamado(newChamado, chamadosDb);
    expect(result.isDuplicate).toBe(false);
  });

  it("deve detectar duplicação por cliente + título + telefone no mesmo dia", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("mesmo cliente, título e telefone");
    expect(result.existingChamadoId).toBe("chamado-1");
  });

  it("deve permitir mesmo título para clientes diferentes", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-2",
      title: "Problema com login",
      phone: "11888888888",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(false);
  });

  it("deve permitir mesmo telefone para clientes diferentes", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-2",
      title: "Problema diferente",
      phone: "11999999999",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(false);
  });

  it("deve detectar duplicação por email do mesmo cliente", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      email: "user@example.com",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-1",
      title: "Outro problema",
      phone: "11888888888",
      email: "user@example.com",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("mesmo cliente e email");
  });

  it("deve permitir email duplicado para clientes diferentes", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      email: "user@example.com",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-2",
      title: "Problema com login",
      phone: "11888888888",
      email: "user@example.com",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(false);
  });

  it("deve permitir mesmo chamado em dias diferentes", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "alta",
      createdAt: yesterday,
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-1",
      title: "Problema com login",
      phone: "11999999999",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(false);
  });

  it("deve ser case-insensitive na comparação de títulos", () => {
    const existingChamado: ChamadoCreate & { id: string; createdAt: Date } = {
      id: "chamado-1",
      clientId: "client-1",
      title: "Problema com LOGIN",
      phone: "11999999999",
      priority: "alta",
      createdAt: new Date(),
    };

    const newChamado: ChamadoCreate = {
      clientId: "client-1",
      title: "problema com login",
      phone: "11999999999",
      priority: "media",
    };

    const result = checkDuplicateChamado(newChamado, [existingChamado]);
    expect(result.isDuplicate).toBe(true);
  });

  it("deve validar schema do chamado", () => {
    const validChamado = {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Problema com login",
      phone: "11999999999",
      priority: "alta",
    };

    const result = ChamadoCreateSchema.safeParse(validChamado);
    expect(result.success).toBe(true);
  });

  it("deve rejeitar chamado com título muito curto", () => {
    const invalidChamado = {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      title: "ab",
      phone: "11999999999",
      priority: "alta",
    };

    const result = ChamadoCreateSchema.safeParse(invalidChamado);
    expect(result.success).toBe(false);
  });

  it("deve rejeitar chamado com telefone inválido", () => {
    const invalidChamado = {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Problema com login",
      phone: "123",
      priority: "alta",
    };

    const result = ChamadoCreateSchema.safeParse(invalidChamado);
    expect(result.success).toBe(false);
  });

  it("deve rejeitar chamado com email inválido", () => {
    const invalidChamado = {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Problema com login",
      phone: "11999999999",
      email: "invalid-email",
      priority: "alta",
    };

    const result = ChamadoCreateSchema.safeParse(invalidChamado);
    expect(result.success).toBe(false);
  });
});
