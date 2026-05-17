import { describe, it, expect, beforeEach } from "vitest";

// Simulação de dados para testes de performance
interface Chamado {
  id: string;
  clientId: string;
  number: number;
  title: string;
  description: string;
  phone: string;
  email?: string;
  status: "open" | "in_progress" | "waiting" | "closed";
  priority: "baixa" | "media" | "alta" | "critica";
  createdAt: Date;
  updatedAt: Date;
  activities: Activity[];
}

interface Activity {
  id: string;
  chamadoId: string;
  type: "created" | "updated" | "comment" | "status_change";
  description: string;
  createdAt: Date;
}

// Função para medir tempo de execução
function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  const end = performance.now();
  return end - start;
}

// Função para gerar dados de teste
function generateChamados(count: number): Chamado[] {
  const chamados: Chamado[] = [];
  for (let i = 0; i < count; i++) {
    chamados.push({
      id: `chamado-${i}`,
      clientId: `client-${i % 10}`,
      number: i + 1,
      title: `Chamado ${i + 1}`,
      description: `Descrição do chamado ${i + 1}`.repeat(10),
      phone: `1199999${String(i).padStart(4, "0")}`,
      email: `user${i}@example.com`,
      status: ["open", "in_progress", "waiting", "closed"][i % 4] as any,
      priority: ["baixa", "media", "alta", "critica"][i % 4] as any,
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
      activities: Array.from({ length: 5 }, (_, j) => ({
        id: `activity-${i}-${j}`,
        chamadoId: `chamado-${i}`,
        type: ["created", "updated", "comment", "status_change"][j % 4] as any,
        description: `Atividade ${j + 1} do chamado ${i + 1}`,
        createdAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
      })),
    });
  }
  return chamados;
}

describe("Performance de Chamados", () => {
  let chamados: Chamado[] = [];

  beforeEach(() => {
    chamados = generateChamados(1000);
  });

  it("deve listar 100 chamados em menos de 100ms", () => {
    const time = measureTime(() => {
      const result = chamados.slice(0, 100);
      expect(result.length).toBe(100);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve listar 1000 chamados em menos de 500ms", () => {
    const time = measureTime(() => {
      const result = chamados;
      expect(result.length).toBe(1000);
    });

    expect(time).toBeLessThan(500);
  });

  it("deve filtrar chamados por status em menos de 50ms", () => {
    const time = measureTime(() => {
      const result = chamados.filter((c) => c.status === "open");
      expect(result.length).toBeGreaterThan(0);
    });

    expect(time).toBeLessThan(50);
  });

  it("deve filtrar chamados por prioridade em menos de 50ms", () => {
    const time = measureTime(() => {
      const result = chamados.filter((c) => c.priority === "alta");
      expect(result.length).toBeGreaterThan(0);
    });

    expect(time).toBeLessThan(50);
  });

  it("deve buscar chamado por ID em menos de 10ms", () => {
    const time = measureTime(() => {
      const result = chamados.find((c) => c.id === "chamado-500");
      expect(result).toBeDefined();
    });

    expect(time).toBeLessThan(10);
  });

  it("deve buscar chamados por cliente em menos de 50ms", () => {
    const time = measureTime(() => {
      const result = chamados.filter((c) => c.clientId === "client-5");
      expect(result.length).toBeGreaterThan(0);
    });

    expect(time).toBeLessThan(50);
  });

  it("deve ordenar chamados por data em menos de 100ms", () => {
    const time = measureTime(() => {
      const result = [...chamados].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      expect(result.length).toBe(1000);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve paginar chamados (10 por página) em menos de 50ms", () => {
    const time = measureTime(() => {
      const page = 5;
      const pageSize = 10;
      const result = chamados.slice((page - 1) * pageSize, page * pageSize);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    expect(time).toBeLessThan(50);
  });

  it("deve contar chamados por status em menos de 50ms", () => {
    const time = measureTime(() => {
      const counts = {
        open: chamados.filter((c) => c.status === "open").length,
        in_progress: chamados.filter((c) => c.status === "in_progress").length,
        waiting: chamados.filter((c) => c.status === "waiting").length,
        closed: chamados.filter((c) => c.status === "closed").length,
      };
      expect(counts.open + counts.in_progress + counts.waiting + counts.closed).toBe(1000);
    });

    expect(time).toBeLessThan(50);
  });

  it("deve acessar atividades de um chamado em menos de 10ms", () => {
    const time = measureTime(() => {
      const chamado = chamados[500];
      const activities = chamado.activities;
      expect(activities.length).toBe(5);
    });

    expect(time).toBeLessThan(10);
  });

  it("deve fazer busca case-insensitive em menos de 100ms", () => {
    const time = measureTime(() => {
      const searchTerm = "chamado";
      const result = chamados.filter((c) =>
        c.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
      expect(result.length).toBeGreaterThan(0);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve mapear dados para exibição em menos de 100ms", () => {
    const time = measureTime(() => {
      const result = chamados.map((c) => ({
        id: c.id,
        number: c.number,
        title: c.title,
        status: c.status,
        priority: c.priority,
        createdAt: c.createdAt.toISOString(),
      }));
      expect(result.length).toBe(1000);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve agrupar chamados por cliente em menos de 100ms", () => {
    const time = measureTime(() => {
      const grouped = chamados.reduce(
        (acc, chamado) => {
          if (!acc[chamado.clientId]) {
            acc[chamado.clientId] = [];
          }
          acc[chamado.clientId].push(chamado);
          return acc;
        },
        {} as Record<string, Chamado[]>
      );
      expect(Object.keys(grouped).length).toBe(10);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve calcular estatísticas em menos de 100ms", () => {
    const time = measureTime(() => {
      const stats = {
        total: chamados.length,
        open: chamados.filter((c) => c.status === "open").length,
        closed: chamados.filter((c) => c.status === "closed").length,
        alta: chamados.filter((c) => c.priority === "alta").length,
        critica: chamados.filter((c) => c.priority === "critica").length,
      };
      expect(stats.total).toBe(1000);
    });

    expect(time).toBeLessThan(100);
  });

  it("deve combinar múltiplos filtros em menos de 100ms", () => {
    const time = measureTime(() => {
      const result = chamados.filter(
        (c) =>
          c.status === "open" &&
          c.priority === "alta" &&
          c.clientId === "client-5"
      );
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    expect(time).toBeLessThan(100);
  });
});
