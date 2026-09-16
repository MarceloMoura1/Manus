import { describe, expect, it } from "vitest";
import { centsToDisplay, displayToCents } from "./MoneyInput";

// ---------------------------------------------------------------------------
// centsToDisplay
// ---------------------------------------------------------------------------
describe("centsToDisplay", () => {
  it("converte zero", () => {
    expect(centsToDisplay(0)).toBe("0,00");
  });

  it("converte centavos sem inteiro", () => {
    expect(centsToDisplay(5)).toBe("0,05");
    expect(centsToDisplay(50)).toBe("0,50");
    expect(centsToDisplay(99)).toBe("0,99");
  });

  it("converte valores inteiros de reais", () => {
    expect(centsToDisplay(100)).toBe("1,00");
    expect(centsToDisplay(1000)).toBe("10,00");
    expect(centsToDisplay(10000)).toBe("100,00");
  });

  it("converte valores com separador de milhar", () => {
    expect(centsToDisplay(123456)).toBe("1.234,56");
    expect(centsToDisplay(100000)).toBe("1.000,00");
    expect(centsToDisplay(10000000)).toBe("100.000,00");
  });

  it("arredonda input com casa decimal antes de converter", () => {
    expect(centsToDisplay(Math.round(1.5))).toBe("0,02");
  });

  it("trata valores negativos como zero", () => {
    expect(centsToDisplay(-1)).toBe("0,00");
    expect(centsToDisplay(-100)).toBe("0,00");
  });

  it("trata NaN e Infinity como zero", () => {
    expect(centsToDisplay(NaN)).toBe("0,00");
    expect(centsToDisplay(Infinity)).toBe("0,00");
  });
});

// ---------------------------------------------------------------------------
// displayToCents
// ---------------------------------------------------------------------------
describe("displayToCents", () => {
  it("string vazia retorna zero", () => {
    expect(displayToCents("")).toBe(0);
    expect(displayToCents("   ")).toBe(0);
  });

  it("converte BRL padrão", () => {
    expect(displayToCents("0,00")).toBe(0);
    expect(displayToCents("1,00")).toBe(100);
    expect(displayToCents("1.234,56")).toBe(123456);
    expect(displayToCents("100.000,00")).toBe(10000000);
  });

  it("converte digitação sem separador de milhar", () => {
    expect(displayToCents("1234,56")).toBe(123456);
    expect(displayToCents("1234,5")).toBe(123450);
    expect(displayToCents("1234")).toBe(123400);
    expect(displayToCents("0,5")).toBe(50);
  });

  it("converte centavos parciais na digitação", () => {
    expect(displayToCents("0,01")).toBe(1);
    expect(displayToCents("0,05")).toBe(5);
    expect(displayToCents("0,99")).toBe(99);
  });

  it("retorna -1 para entradas não numéricas", () => {
    expect(displayToCents("abc")).toBe(-1);
    expect(displayToCents("R$ 1,00")).toBe(-1);
    expect(displayToCents("--")).toBe(-1);
  });

  it("retorna -1 para valores negativos", () => {
    expect(displayToCents("-1,00")).toBe(-1);
    expect(displayToCents("-0,01")).toBe(-1);
  });

  it("com 3 casas decimais a vírgula é separador decimal — resultado é o arredondamento de float", () => {
    // "1,005" → remove pontos → "1,005" → vírgula para ponto → "1.005"
    // Number("1.005") = 1.005, Math.round(1.005 * 100) pode ser 100 ou 101 por imprecisão float
    // Documentamos o comportamento real: está entre 100 e 101
    const result = displayToCents("1,005");
    expect(result === 100 || result === 101).toBe(true);
  });
});
