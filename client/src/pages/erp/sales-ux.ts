import type { SalesAddress, SalesForm } from "./sales-form";

export const SALES_LOOKUP_MIN_LENGTH = 2;

export function canRunSalesLookup(value: string) {
  return value.trim().length >= SALES_LOOKUP_MIN_LENGTH;
}

export function salesAddressesMatch(
  shipping: SalesAddress | null | undefined,
  billing: SalesAddress | null | undefined
) {
  if (!shipping || !billing) return !shipping && !billing;
  return (Object.keys(shipping) as Array<keyof SalesAddress>).every(
    key => shipping[key].trim() === billing[key].trim()
  );
}

export function salesDraftProgress(form: SalesForm) {
  return [
    { key: "customer", label: "Cliente", complete: Boolean(form.crmClientId) },
    { key: "products", label: "Produtos", complete: form.items.length > 0 },
    {
      key: "address",
      label: "Endereço",
      complete: Boolean(
        form.shippingAddress?.recipientName.trim() &&
          form.shippingAddress?.street.trim() &&
          form.shippingAddress?.city.trim() &&
          form.shippingAddress?.state.trim()
      ),
    },
    {
      key: "values",
      label: "Valores",
      complete:
        form.items.length > 0 &&
        form.items.every(
          item => Number(item.quantity) > 0 && item.unitPriceCents >= 0
        ),
    },
  ] as const;
}

export type SalesConfirmationRequirement = {
  key: "customer" | "products" | "address" | "payment" | "category" | "account" | "installments";
  label: string;
  complete: boolean;
  actionLabel?: string;
};

export function salesConfirmationRequirements(input: {
  hasCustomer: boolean;
  hasProducts: boolean;
  hasAddress: boolean;
  paymentMethod: string;
  categoryPublicId: string;
  financialAccountPublicId: string;
  installmentCount: number;
  firstDueDate: string;
}): SalesConfirmationRequirement[] {
  return [
    { key: "customer", label: "Cliente", complete: input.hasCustomer },
    { key: "products", label: "Produtos", complete: input.hasProducts },
    { key: "address", label: "Endereço", complete: input.hasAddress },
    {
      key: "payment",
      label: "Forma de pagamento",
      complete: Boolean(input.paymentMethod),
      actionLabel: "Selecionar forma",
    },
    {
      key: "category",
      label: "Categoria financeira",
      complete: Boolean(input.categoryPublicId),
      actionLabel: "Selecionar categoria",
    },
    {
      key: "account",
      label: "Conta prevista",
      complete: Boolean(input.financialAccountPublicId),
      actionLabel: "Selecionar conta",
    },
    {
      key: "installments",
      label: "Parcelas e vencimento",
      complete: input.installmentCount > 0 && Boolean(input.firstDueDate),
      actionLabel: "Definir parcelas",
    },
  ];
}

export function activeSalesFilterCount(input: {
  search: string;
  stage: string;
  paymentStatus: string;
  paymentMethod: string;
  sellerUserId: string;
  customerId?: string;
  from: string;
  to: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  return [
    Boolean(input.search.trim()),
    input.stage !== "all",
    input.paymentStatus !== "all",
    input.paymentMethod !== "all",
    input.sellerUserId !== "all",
    Boolean(input.customerId),
    input.from !== input.defaultFrom || input.to !== input.defaultTo,
  ].filter(Boolean).length;
}
