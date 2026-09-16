import React from "react";
type StatusVariant =
  | "active"
  | "inactive"
  | "draft"
  | "approved"
  | "received"
  | "confirmed"
  | "fulfilled"
  | "cancelled"
  | "open"
  | "settled"
  | "complete"
  | "incomplete"
  | "ready"
  | "reversed"
  | "reversal";

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  active:    "bg-emerald-100 text-emerald-800",
  inactive:  "bg-slate-100 text-slate-600",
  draft:     "bg-slate-100 text-slate-600",
  approved:  "bg-blue-100 text-blue-800",
  received:  "bg-emerald-100 text-emerald-800",
  confirmed: "bg-blue-100 text-blue-800",
  fulfilled: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
  open:      "bg-amber-100 text-amber-800",
  settled:   "bg-emerald-100 text-emerald-800",
  complete:  "bg-emerald-100 text-emerald-800",
  incomplete:"bg-amber-100 text-amber-800",
  ready:     "bg-blue-100 text-blue-800",
  reversed:  "bg-amber-100 text-amber-800",
  reversal:  "bg-blue-100 text-blue-800",
};

type ErpStatusBadgeProps = {
  variant: StatusVariant;
  label: string;
};

/**
 * Badge de status padrão ERP.
 * Não acoplado a nenhum domínio específico — recebe variant e label explicitamente.
 * Extensível: adicionar um novo variant = adicionar entrada em VARIANT_CLASSES.
 */
export function ErpStatusBadge({ variant, label }: ErpStatusBadgeProps) {
  const classes = VARIANT_CLASSES[variant] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

export type { StatusVariant };
