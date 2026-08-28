export const CUSTOMER_TYPES = ["person", "company"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type CrmWhatsAppIntent = {
  crmClientId: string;
  phone: string;
  channel: "whatsapp";
};

export function parseCustomerType(value: string | null | undefined): CustomerType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "person" || normalized === "pessoa") return "person";
  if (normalized === "company" || normalized === "empresa") return "company";
  throw new Error(`Tipo de cliente inválido: "${value}". Use pessoa, empresa, person ou company.`);
}

export function customerTypeToCsv(value: CustomerType | null): string {
  return value === "person" ? "pessoa" : value === "company" ? "empresa" : "";
}
