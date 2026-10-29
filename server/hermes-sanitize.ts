/**
 * Utilitários de blindagem de payloads do Hermes: normalizam valores nulos antes de chegar
 * aos serviços de ERP/CRM e convertem erros de validação (Zod) em mensagens amigáveis.
 */

export type HermesFieldKind = "text" | "number" | "list";

const FIELD_LABELS: Record<string, string> = {
  legalName: "razão social/nome",
  tradeName: "nome fantasia",
  name: "nome",
  taxId: "CPF/CNPJ",
  document: "CPF/CNPJ",
  stateRegistration: "inscrição estadual",
  email: "e-mail",
  phone: "telefone",
  contactName: "nome do contato",
  postalCode: "CEP",
  street: "rua",
  addressNumber: "número",
  addressComplement: "complemento",
  district: "bairro",
  city: "cidade",
  state: "UF",
  notes: "observações",
  sku: "código (SKU)",
  unit: "unidade",
  salePriceCents: "preço de venda",
  costPriceCents: "preço de custo",
  price: "preço",
  category: "categoria",
  items: "itens",
  quantity: "quantidade",
  unitPrice: "preço unitário",
  clientName: "cliente",
};

/** Nome amigável (em português) de um campo técnico. */
export function friendlyFieldName(path: unknown): string {
  const segments = Array.isArray(path) ? path.filter(part => typeof part === "string") as string[] : [String(path ?? "")];
  const key = segments[segments.length - 1] ?? "";
  return FIELD_LABELS[key] ?? (key || "dados informados");
}

/**
 * Percorre o payload e substitui null/undefined conforme o tipo esperado do campo:
 * texto -> "", número -> 0, lista -> []. Campos desconhecidos nulos são descartados.
 */
export function sanitizeHermesPayload(
  input: unknown,
  shape: Record<string, HermesFieldKind> = {},
): Record<string, unknown> {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) {
      const kind = shape[key];
      if (kind === "text") result[key] = "";
      else if (kind === "number") result[key] = 0;
      else if (kind === "list") result[key] = [];
      continue;
    }
    result[key] = typeof value === "string" ? value.trim() : value;
  }
  for (const [key, kind] of Object.entries(shape)) {
    if (result[key] !== undefined) continue;
    if (kind === "text") result[key] = "";
    else if (kind === "number") result[key] = 0;
    else if (kind === "list") result[key] = [];
  }
  return result;
}

/** Remove chaves nulas/vazias de primeiro nível (usado antes de validar argumentos de ferramentas). */
export function dropEmptyArgs(args: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function issuesOf(error: unknown): Array<{ path?: unknown }> | null {
  if (!error || typeof error !== "object") return null;
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues)) return issues as Array<{ path?: unknown }>;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(message);
      if (Array.isArray(parsed) && parsed.every(item => item && typeof item === "object" && "path" in item)) {
        return parsed as Array<{ path?: unknown }>;
      }
    } catch { /* mensagem não é JSON de issues */ }
  }
  return null;
}

/** Converte qualquer erro em texto seguro e amigável; nunca devolve o array cru do Zod. */
export function formatHermesError(error: unknown): string {
  const issues = issuesOf(error);
  if (issues) {
    const fields = Array.from(new Set(issues.map(issue => friendlyFieldName(issue.path)))).filter(Boolean);
    return `Não foi possível concluir o cadastro: os dados informados são inválidos (campos pendentes: ${fields.join(", ") || "dados informados"}).`;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido";
  return message.replace(/[.\s]+$/, "");
}
