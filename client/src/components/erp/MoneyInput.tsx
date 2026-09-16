import React from "react";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Utilitários de conversão  (centavos inteiros ↔ string de apresentação BRL)
// ---------------------------------------------------------------------------

/**
 * Converte centavos inteiros para string de apresentação BRL.
 *
 * Exemplos:
 *   0        → "0,00"
 *   100      → "1,00"
 *   150      → "1,50"
 *   123456   → "1.234,56"
 *   -1       → "0,00"    (inválido → zero)
 */
export function centsToDisplay(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return "0,00";
  const safe = Math.round(Math.trunc(cents));
  const integer = Math.trunc(safe / 100);
  const frac = safe % 100;
  const intFormatted = integer.toLocaleString("pt-BR");
  return `${intFormatted},${String(frac).padStart(2, "0")}`;
}

/**
 * Converte string de apresentação BRL para centavos inteiros.
 *
 * Aceita tanto o formato BRL ("1.234,56") quanto digitação parcial ("1234,5").
 * Retorna -1 quando o valor não puder ser interpretado.
 *
 * Exemplos:
 *   "0,00"      → 0
 *   "1,00"      → 100
 *   "1.234,56"  → 123456
 *   "1234,5"    → 123450
 *   "1234"      → 123400  (sem vírgula = inteiros)
 *   ""          → 0
 *   "abc"       → -1
 */
export function displayToCents(display: string): number {
  const trimmed = display.trim();
  if (!trimmed) return 0;

  // Remove separadores de milhar (ponto), normaliza vírgula para ponto
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return -1;

  return Math.round(parsed * 100);
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

type MoneyInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  /**
   * Valor em centavos inteiros.
   * Use -1 ou undefined para campo vazio/inválido.
   */
  valueCents: number | undefined;
  /**
   * Chamado a cada alteração com o novo valor em centavos.
   * Recebe -1 quando o texto digitado não é um valor monetário válido.
   */
  onChangeCents: (cents: number) => void;
  /** Label de acessibilidade — passado como aria-label quando não houver htmlFor */
  label?: string;
};

/**
 * Input monetário padrão ERP.
 *
 * Contrato de domínio: o valor persistido é sempre centavos inteiros (number).
 * A apresentação usa formato BRL (R$ não incluído — apenas "1.234,56").
 *
 * Comportamento:
 * - Na montagem e no blur: formata o valor em BRL.
 * - Durante a digitação: permite entrada livre para não interromper o usuário.
 * - No blur: re-formata e dispara onChangeCents.
 * - Zero é exibido como "0,00".
 * - Valores inválidos retornam -1 via onChangeCents e exibem a entrada como está.
 */
export function MoneyInput({
  valueCents,
  onChangeCents,
  label,
  className,
  id,
  ...rest
}: MoneyInputProps) {
  const resolvedCents = valueCents !== undefined && valueCents >= 0 ? valueCents : 0;
  const [display, setDisplay] = React.useState<string>(() => centsToDisplay(resolvedCents));
  const [focused, setFocused] = React.useState(false);

  // Sincroniza quando valueCents mudar externamente (apenas quando não focado)
  React.useEffect(() => {
    if (!focused) {
      setDisplay(centsToDisplay(valueCents !== undefined && valueCents >= 0 ? valueCents : 0));
    }
  }, [valueCents, focused]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setDisplay(raw);
    const cents = displayToCents(raw);
    onChangeCents(cents);
  }

  function handleBlur() {
    setFocused(false);
    const cents = displayToCents(display);
    if (cents >= 0) {
      setDisplay(centsToDisplay(cents));
      onChangeCents(cents);
    } else {
      // Mantém o texto inválido visível para o usuário corrigir
      onChangeCents(-1);
    }
  }

  function handleFocus() {
    setFocused(true);
  }

  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="decimal"
      type="text"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={className}
      {...rest}
    />
  );
}
