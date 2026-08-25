import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const reportSections = [
  "executive",
  "sales",
  "purchases",
  "stock",
  "finance",
  "clients",
  "suppliers",
  "fiscal",
] as const;
export type ReportSection = (typeof reportSections)[number];
const date = z.string().date(),
  publicId = z.union([
    z.string().uuid(),
    z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
  ]),
  reportStatus = z.enum([
    "draft",
    "confirmed",
    "fulfilled",
    "approved",
    "received",
    "cancelled",
    "open",
    "settled",
    "ready_for_integration",
  ]);
export const reportSorts = {
  executive: [],
  sales: ["number", "date", "total", "customer"],
  purchases: ["number", "date", "total", "supplier"],
  stock: ["product", "sku", "quantity", "movement"],
  finance: ["dueDate", "amount", "status", "party"],
  clients: ["name", "createdAt", "salesTotal"],
  suppliers: ["name", "createdAt", "purchasesTotal"],
  fiscal: ["number", "date", "status", "origin"],
} as const satisfies Record<ReportSection, readonly string[]>;
export const reportStatuses = {
  executive: [], sales: ["draft", "confirmed", "fulfilled", "cancelled"],
  purchases: ["draft", "approved", "received", "cancelled"], stock: [],
  finance: ["open", "settled", "cancelled"], clients: [], suppliers: [],
  fiscal: ["draft", "ready_for_integration", "cancelled"],
} as const satisfies Record<ReportSection, readonly string[]>;
const reportSort = z.enum(["number", "date", "total", "customer", "supplier", "product", "sku", "quantity", "movement", "dueDate", "amount", "status", "party", "name", "createdAt", "salesTotal", "purchasesTotal", "origin"]);
export const MAX_REPORT_DAYS = 366,
  MAX_REPORT_ROWS = 1000;
export const reportFilterInput = z
  .object({
    from: date,
    to: date,
    status: reportStatus.optional(),
    publicId: publicId.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    sort: reportSort.optional(),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((v, ctx) => {
    const from = new Date(`${v.from}T00:00:00.000Z`),
      to = new Date(`${v.to}T00:00:00.000Z`);
    if (from > to)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "A data final deve ser igual ou posterior à inicial.",
      });
    if (
      Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1 >
      MAX_REPORT_DAYS
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `O período máximo é de ${MAX_REPORT_DAYS} dias.`,
      });
  });
export const reportRequestInput = reportFilterInput.safeExtend({ section: z.enum(reportSections) }).superRefine((v, ctx) => {
  if (v.sort && !(reportSorts[v.section] as readonly string[]).includes(v.sort))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sort"], message: "OrdenaÃ§Ã£o incompatÃ­vel com a seÃ§Ã£o." });
  if (v.status && !(reportStatuses[v.section] as readonly string[]).includes(v.status))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Estado incompatÃ­vel com a seÃ§Ã£o." });
});
export const exportRequestInput = reportRequestInput.safeExtend({
  maxRows: z
    .number()
    .int()
    .min(1)
    .max(MAX_REPORT_ROWS)
    .default(MAX_REPORT_ROWS),
});
export type ReportFilter = z.infer<typeof reportFilterInput>;
export type ReportRequest = z.infer<typeof reportRequestInput>;
export const canReadReports = (role: OperationalRole) =>
  role === "admin" || role === "manager" || role === "viewer";
export const canExportReports = (role: OperationalRole) =>
  role === "admin" || role === "manager";
export const previousPeriod = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00.000Z`),
    end = new Date(`${to}T00:00:00.000Z`),
    days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1,
    previousTo = new Date(start.getTime() - 86_400_000),
    previousFrom = new Date(previousTo.getTime() - (days - 1) * 86_400_000);
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
};
export const comparison = (current: number, previous: number) => ({
  current,
  previous,
  absoluteChange: current - previous,
  percentageChange: previous !== 0 ? ((current - previous) * 100) / previous : null,
});
export const csvCell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const rowsToCsv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map(row => headers.map(h => csvCell(row[h])).join(",")),
  ].join("\r\n");
};
