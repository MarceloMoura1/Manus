/**
 * conditions.ts — Motor de avaliação de condições de regras de automação
 * Baseado no motor de alta precisão do DeskcommCRM:
 * Normalização NFD para remoção de marcas diacríticas (acentos) e pontuação convertida em espaços.
 */

export type ConditionOp = "eq" | "neq" | "contains";

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

export function normalizarParaContains(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formaDaRegra(valorDaRegra: string): (valor: unknown) => string {
  return normalizarParaContains(valorDaRegra) === ""
    ? (valor) => (valor !== null && valor !== undefined ? String(valor).toLowerCase() : "")
    : normalizarParaContains;
}

export function resolveField(context: Record<string, unknown>, path: string): unknown {
  if (!context || typeof context !== "object") return undefined;
  let cur: unknown = context;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function matches(cond: RuleCondition, context: Record<string, unknown>): boolean {
  const raw = resolveField(context, cond.field);
  if (raw === undefined || raw === null) return cond.op === "neq";

  if (cond.op === "contains") {
    const forma = formaDaRegra(cond.value);
    const alvo = forma(cond.value);

    if (Array.isArray(raw)) {
      return raw.some((item) => forma(item) === alvo);
    }
    return forma(raw).includes(alvo);
  }

  const equal = String(raw).trim() === cond.value.trim();
  return cond.op === "eq" ? equal : !equal;
}

export function evaluateConditions(
  conditions: RuleCondition[],
  context: Record<string, unknown>
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => matches(c, context));
}

export interface ConditionEvaluationDetail {
  field: string;
  op: ConditionOp;
  expectedValue: string;
  actualValue: unknown;
  matched: boolean;
}

export function evaluateConditionsDetailed(
  conditions: RuleCondition[],
  context: Record<string, unknown>
): { allMatched: boolean; evaluations: ConditionEvaluationDetail[] } {
  if (!conditions || conditions.length === 0) {
    return { allMatched: true, evaluations: [] };
  }
  const evaluations: ConditionEvaluationDetail[] = conditions.map((c) => {
    const actual = resolveField(context, c.field);
    const matched = matches(c, context);
    return {
      field: c.field,
      op: c.op,
      expectedValue: c.value,
      actualValue: actual,
      matched,
    };
  });
  const allMatched = evaluations.every((e) => e.matched);
  return { allMatched, evaluations };
}
