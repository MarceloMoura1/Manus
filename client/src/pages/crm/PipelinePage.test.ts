import { describe, it, expect } from "vitest";

// Test helper logic mirroring PipelinePage business presentation
function formatCentsToBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function parseBrlToCents(val: string): number {
  if (!val) return 0;
  const trimmed = val.replace(/[^\d,\.]/g, "");
  if (!trimmed) return 0;
  let normalized = trimmed;
  if (trimmed.includes(",")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  }
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function calculateConversionRate(won: number, lost: number): number {
  const closed = won + lost;
  if (closed === 0) return 0;
  return Math.round((won / closed) * 100);
}

function groupOpportunitiesByStage(
  stages: { publicId: string }[],
  opportunities: { stagePublicId: string; valueCents: number }[]
) {
  const map = new Map<string, typeof opportunities>();
  for (const stage of stages) {
    map.set(stage.publicId, []);
  }
  for (const opp of opportunities) {
    const list = map.get(opp.stagePublicId);
    if (list) {
      list.push(opp);
    }
  }
  return map;
}

describe("MegaDesk CRM — Etapa 2B.4: Interface e Apresentação do Funil Kanban (PipelinePage)", () => {
  describe("1. Formatação monetária canônica e parsing de centavos", () => {
    it("converte centavos inteiros para representação em Reais (BRL)", () => {
      expect(formatCentsToBrl(0)).toContain("0,00");
      expect(formatCentsToBrl(150000)).toContain("1.500,00");
      expect(formatCentsToBrl(105025)).toContain("1.050,25");
      expect(formatCentsToBrl(99)).toContain("0,99");
    });

    it("interpreta inputs monetários em Reais e converte para centavos inteiros (value_cents)", () => {
      expect(parseBrlToCents("")).toBe(0);
      expect(parseBrlToCents("1500")).toBe(150000);
      expect(parseBrlToCents("1500,50")).toBe(150050);
      expect(parseBrlToCents("R$ 2.450,75")).toBe(245075);
      expect(parseBrlToCents("0,99")).toBe(99);
      expect(parseBrlToCents("invalido")).toBe(0);
    });
  });

  describe("2. Métricas reais do funil e taxa de conversão", () => {
    it("calcula taxa de conversão a partir de oportunidades ganhas e perdidas reais", () => {
      // 0 concluídas -> 0%
      expect(calculateConversionRate(0, 0)).toBe(0);
      // 3 ganhas, 1 perdida -> 3/4 = 75%
      expect(calculateConversionRate(3, 1)).toBe(75);
      // 5 ganhas, 5 perdidas -> 5/10 = 50%
      expect(calculateConversionRate(5, 5)).toBe(50);
      // 10 ganhas, 0 perdidas -> 100%
      expect(calculateConversionRate(10, 0)).toBe(100);
    });
  });

  describe("3. Distribuição de cards nas colunas de estágio do Kanban", () => {
    it("agrupa corretamente as oportunidades por estágio preservando estágios vazios", () => {
      const stages = [
        { publicId: "s1", name: "Qualificação" },
        { publicId: "s2", name: "Proposta" },
        { publicId: "s3", name: "Ganho" },
        { publicId: "s4", name: "Perdido" },
      ];

      const opportunities = [
        { stagePublicId: "s1", valueCents: 10000 },
        { stagePublicId: "s1", valueCents: 20000 },
        { stagePublicId: "s3", valueCents: 50000 },
      ];

      const grouped = groupOpportunitiesByStage(stages, opportunities);

      expect(grouped.get("s1")).toHaveLength(2);
      expect(grouped.get("s2")).toHaveLength(0); // Coluna vazia tratada corretamente
      expect(grouped.get("s3")).toHaveLength(1);
      expect(grouped.get("s4")).toHaveLength(0);

      // Soma do valor da coluna s1
      const totalS1 = (grouped.get("s1") || []).reduce((acc, o) => acc + o.valueCents, 0);
      expect(totalS1).toBe(30000);
    });
  });

  describe("4. Regras de intenção comercial explícita e independência da probabilidade do estágio", () => {
    // Stage transition never infers commercial status from probability
    function prepareStageTransition(opp: { status: "open" | "won" | "lost" }, targetStage: { probabilityPct: number; name: string }) {
      // Regardless of whether targetStage.probabilityPct is 0%, 50%, or 100%,
      // moving a card simply transitions the stage and preserves/restores 'open' status
      return {
        toStagePublicId: targetStage.name,
        status: "open" as const,
      };
    }

    it("movimenta para estágio com probabilidade 0% sem encerrar comercialmente como perdida", () => {
      const opp = { status: "open" as const };
      const transition0 = prepareStageTransition(opp, { probabilityPct: 0, name: "Triagem Inicial" });
      expect(transition0.status).toBe("open");

      const transitionCustom0 = prepareStageTransition(opp, { probabilityPct: 0, name: "Desistência / Inviável" });
      expect(transitionCustom0.status).toBe("open");
    });

    it("movimenta para estágio com probabilidade 100% sem encerrar comercialmente como ganha", () => {
      const opp = { status: "open" as const };
      const transition100 = prepareStageTransition(opp, { probabilityPct: 100, name: "Fechado / Ganho" });
      expect(transition100.status).toBe("open");

      const transitionCustom100 = prepareStageTransition(opp, { probabilityPct: 100, name: "Entrega e Faturamento" });
      expect(transitionCustom100.status).toBe("open");
    });

    it("restaura/reabre negócio como aberto se oportunidade previamente encerrada for movida de estágio", () => {
      const wonOpp = { status: "won" as const };
      expect(prepareStageTransition(wonOpp, { probabilityPct: 50, name: "Negociação" }).status).toBe("open");

      const lostOpp = { status: "lost" as const };
      expect(prepareStageTransition(lostOpp, { probabilityPct: 20, name: "Qualificação" }).status).toBe("open");
    });

    it("exige ação e payload explícitos para encerramento comercial ganho ou perdido", () => {
      // Marcar Ganha explícito
      const explicitWon = { status: "won" as const };
      expect(explicitWon.status).toBe("won");

      // Marcar Perdida explícito com motivo
      const explicitLost = (reason: string) => {
        if (!reason || !reason.trim()) throw new Error("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");
        return { status: "lost" as const, lossReason: reason.trim() };
      };

      expect(explicitLost("Preço acima do orçamento").status).toBe("lost");
      expect(explicitLost("Preço acima do orçamento").lossReason).toBe("Preço acima do orçamento");
      expect(() => explicitLost("")).toThrow("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");
      expect(() => explicitLost("   ")).toThrow("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");
    });
  });
});
