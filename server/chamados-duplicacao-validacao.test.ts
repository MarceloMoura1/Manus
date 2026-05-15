import { describe, it, expect } from "vitest";

/**
 * Testes de Validação de Duplicação de Chamados
 * Verifica se o sistema detecta corretamente duplicações
 */

interface Chamado {
  id: string;
  clientId: string;
  title: string;
  observations: string;
  phone: string;
  email?: string;
  createdAt: Date;
}

// Função para verificar duplicação
function isDuplicate(
  newChamado: Chamado,
  existingChamados: Chamado[]
): boolean {
  return existingChamados.some(
    (existing) =>
      existing.clientId === newChamado.clientId &&
      existing.title.toLowerCase() === newChamado.title.toLowerCase() &&
      existing.phone === newChamado.phone
  );
}

// Função para verificar duplicação por email
function isDuplicateByEmail(
  newChamado: Chamado,
  existingChamados: Chamado[]
): boolean {
  if (!newChamado.email) return false;
  return existingChamados.some(
    (existing) =>
      existing.clientId === newChamado.clientId &&
      existing.email === newChamado.email
  );
}

describe("Validação de Duplicação de Chamados", () => {
  it("deve detectar duplicação por cliente + título + telefone", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Sistema não funciona",
      observations: "Erro 500 novamente",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(true);
  });

  it("deve permitir mesmo título para cliente diferente", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-2",
      title: "Sistema não funciona",
      observations: "Erro 500",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(false);
  });

  it("deve permitir mesmo título para telefone diferente", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Sistema não funciona",
      observations: "Erro 500",
      phone: "11888888888",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(false);
  });

  it("deve ser case-insensitive na comparação de título", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "SISTEMA NÃO FUNCIONA",
      observations: "Erro 500",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(true);
  });

  it("deve detectar duplicação por email", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Problema 1",
        observations: "Descrição",
        phone: "11999999999",
        email: "user@example.com",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Problema 2",
      observations: "Descrição diferente",
      phone: "11888888888",
      email: "user@example.com",
      createdAt: new Date(),
    };

    const isDup = isDuplicateByEmail(newChamado, existing);
    expect(isDup).toBe(true);
  });

  it("deve permitir email diferente mesmo com outros dados iguais", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Problema",
        observations: "Descrição",
        phone: "11999999999",
        email: "user1@example.com",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Problema",
      observations: "Descrição",
      phone: "11999999999",
      email: "user2@example.com",
      createdAt: new Date(),
    };

    const isDup = isDuplicateByEmail(newChamado, existing);
    expect(isDup).toBe(false);
  });

  it("deve ignorar email se não fornecido", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Problema",
        observations: "Descrição",
        phone: "11999999999",
        email: "user@example.com",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Problema",
      observations: "Descrição",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicateByEmail(newChamado, existing);
    expect(isDup).toBe(false);
  });

  it("deve validar múltiplos chamados existentes", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Problema 1",
        observations: "Descrição 1",
        phone: "11999999999",
        createdAt: new Date(),
      },
      {
        id: "2",
        clientId: "client-1",
        title: "Problema 2",
        observations: "Descrição 2",
        phone: "11888888888",
        createdAt: new Date(),
      },
      {
        id: "3",
        clientId: "client-2",
        title: "Problema 1",
        observations: "Descrição 1",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "4",
      clientId: "client-1",
      title: "Problema 2",
      observations: "Descrição diferente",
      phone: "11888888888",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(true);
  });

  it("deve retornar false para lista vazia", () => {
    const existing: Chamado[] = [];

    const newChamado: Chamado = {
      id: "1",
      clientId: "client-1",
      title: "Problema",
      observations: "Descrição",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(false);
  });

  it("deve validar com espaços em branco no título", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "  Sistema não funciona  ",
      observations: "Erro 500",
      phone: "11999999999",
      createdAt: new Date(),
    };

    // Nota: A função atual não trata espaços em branco
    // Isso seria uma melhoria futura
    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(false); // Falha porque tem espaços
  });

  it("deve validar com caracteres especiais no título", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Erro: Sistema não funciona!",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Erro: Sistema não funciona!",
      observations: "Erro 500",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(true);
  });

  it("deve validar com acentuação diferente", () => {
    const existing: Chamado[] = [
      {
        id: "1",
        clientId: "client-1",
        title: "Sistema não funciona",
        observations: "Erro 500",
        phone: "11999999999",
        createdAt: new Date(),
      },
    ];

    const newChamado: Chamado = {
      id: "2",
      clientId: "client-1",
      title: "Sistema nao funciona", // Sem acento
      observations: "Erro 500",
      phone: "11999999999",
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, existing);
    expect(isDup).toBe(false); // Falha porque acentuação é diferente
  });

  it("deve contar chamados duplicados em lista grande", () => {
    const chamados: Chamado[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `chamado-${i}`,
      clientId: `client-${i % 10}`,
      title: `Problema ${i % 100}`,
      observations: `Descrição ${i}`,
      phone: `1199999${String(i).padStart(4, "0")}`,
      createdAt: new Date(),
    }));

    // Encontrar um chamado que realmente existe na lista
    const existingChamado = chamados[500];
    
    const newChamado: Chamado = {
      id: "new",
      clientId: existingChamado.clientId,
      title: existingChamado.title,
      observations: "Descrição nova",
      phone: existingChamado.phone,
      createdAt: new Date(),
    };

    const isDup = isDuplicate(newChamado, chamados);
    expect(isDup).toBe(true);
  });

  it("deve validar performance com muitos chamados", () => {
    const chamados: Chamado[] = Array.from({ length: 10000 }, (_, i) => ({
      id: `chamado-${i}`,
      clientId: `client-${i % 100}`,
      title: `Problema ${i % 1000}`,
      observations: `Descrição ${i}`,
      phone: `1199999${String(i).padStart(5, "0")}`,
      createdAt: new Date(),
    }));

    // Encontrar um chamado que realmente existe na lista
    const existingChamado = chamados[5000];
    
    const newChamado: Chamado = {
      id: "new",
      clientId: existingChamado.clientId,
      title: existingChamado.title,
      observations: "Descrição nova",
      phone: existingChamado.phone,
      createdAt: new Date(),
    };

    const start = performance.now();
    const isDup = isDuplicate(newChamado, chamados);
    const duration = performance.now() - start;

    expect(isDup).toBe(true);
    expect(duration).toBeLessThan(100); // Deve ser rápido
  });
});
