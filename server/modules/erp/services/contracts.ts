import { z } from "zod";

export const serviceIdSchema = z.number().int().positive();

export function parseCurrency(val: number | string): string {
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) throw new Error("Preço deve ser maior ou igual a zero");
    return val.toFixed(2);
  }
  const trimmed = val.trim();
  if (!trimmed) throw new Error("Preço é obrigatório");
  if (trimmed.includes(",")) {
    const cleaned = trimmed.replace(/\./g, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Preço deve ser maior ou igual a zero");
    return parsed.toFixed(2);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Preço deve ser maior ou igual a zero");
  return parsed.toFixed(2);
}

export function parseCost(val: number | string | null | undefined): string {
  if (val === undefined || val === null || val === "") return "0.00";
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) return "0.00";
    return val.toFixed(2);
  }
  const trimmed = val.trim();
  if (!trimmed) return "0.00";
  if (trimmed.includes(",")) {
    const cleaned = trimmed.replace(/\./g, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) return "0.00";
    return parsed.toFixed(2);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return "0.00";
  return parsed.toFixed(2);
}

export const serviceInput = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(255),
  code: z.string().trim().max(50).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  price: z.union([z.number(), z.string()]).transform(parseCurrency),
  estimatedCost: z.union([z.number(), z.string()]).nullable().optional().transform(parseCost),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const serviceUpdateInput = z.object({
  id: serviceIdSchema,
  name: z.string().trim().min(1, "Nome é obrigatório").max(255).optional(),
  code: z.string().trim().max(50).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  price: z.union([z.number(), z.string()]).optional().transform(val => val === undefined ? undefined : parseCurrency(val)),
  estimatedCost: z.union([z.number(), z.string()]).nullable().optional().transform(val => val === undefined ? undefined : parseCost(val)),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const serviceListInput = z.object({
  query: z.string().trim().optional(),
  category: z.string().trim().optional(),
  activeOnly: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type ServiceInput = z.infer<typeof serviceInput>;
export type ServiceUpdateInput = z.infer<typeof serviceUpdateInput>;
export type ServiceListInput = z.infer<typeof serviceListInput>;

export type ServiceItem = {
  id: number;
  clientId: string;
  name: string;
  code: string | null;
  category: string | null;
  price: string;
  estimatedCost: string;
  estimatedMinutes: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServiceListResult = {
  items: ServiceItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
