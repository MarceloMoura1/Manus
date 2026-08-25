import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canExportReports,
  canReadReports,
  comparison,
  previousPeriod,
  rowsToCsv,
  type ReportRequest,
} from "./contracts";
import { ReportsRepository } from "./repository";
type Identity = { clientId: string; userId: string; role: OperationalRole };
export class ReportsService {
  constructor(private repository = new ReportsRepository()) {}
  private read(i: Identity) {
    if (!canReadReports(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite acessar Relatórios."
      );
  }
  async report(i: Identity, input: ReportRequest) {
    this.read(i);
    const data = await this.repository.report(i.clientId, input.section, input);
    let comparisonData: Record<string, ReturnType<typeof comparison>> | undefined;
    if (input.section === "executive") {
      const prior = previousPeriod(input.from, input.to);
      const previous = await this.repository.report(i.clientId, "executive", { ...input, ...prior }) as any;
      const current = data as any;
      comparisonData = {
        fulfilledSalesCount: comparison(Number(current.sales?.count ?? 0), Number(previous.sales?.count ?? 0)),
        fulfilledSalesValueCents: comparison(Number(current.sales?.valueCents ?? 0), Number(previous.sales?.valueCents ?? 0)),
        receivedPurchasesCount: comparison(Number(current.purchases?.count ?? 0), Number(previous.purchases?.count ?? 0)),
        receivedPurchasesValueCents: comparison(Number(current.purchases?.valueCents ?? 0), Number(previous.purchases?.valueCents ?? 0)),
        receivedCents: comparison(Number(current.settlements?.receivedCents ?? 0), Number(previous.settlements?.receivedCents ?? 0)),
        paidCents: comparison(Number(current.settlements?.paidCents ?? 0), Number(previous.settlements?.paidCents ?? 0)),
      };
    }
    return {
      section: input.section,
      period: {
        from: input.from,
        to: input.to,
        timezone: "UTC",
        inclusive: true,
      },
      page: input.page,
      pageSize: input.pageSize,
      canExport: canExportReports(i.role),
      data,
      comparison: comparisonData,
    };
  }
  async exportCsv(i: Identity, input: ReportRequest & { maxRows: number }) {
    this.read(i);
    if (!canExportReports(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite exportar Relatórios."
      );
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; rows.length < input.maxRows; page++) {
      const value = (await this.repository.report(i.clientId, input.section, {
        ...input,
        page,
        pageSize: Math.min(100, input.maxRows - rows.length),
      })) as any;
      if (page === 1 && Number(value?.total ?? 0) > input.maxRows)
        throw new ErpDomainError("VALIDATION", `A exportaÃ§Ã£o excede o limite de ${input.maxRows} linhas.`);
      if (input.section === "executive") {
        rows.push(
          ...Object.entries(value ?? {}).flatMap(([group, metrics]) =>
            Object.entries(metrics as Record<string, unknown>)
              .filter(([, v]) => typeof v !== "object")
              .map(([metric, v]) => ({ group, metric, value: v }))
          )
        );
        break;
      }
      const batch = Array.isArray(value)
        ? value
        : Array.isArray(value?.items)
          ? value.items
          : [];
      rows.push(...batch);
      if (
        batch.length < Math.min(100, input.maxRows - rows.length + batch.length)
      )
        break;
    }
    return {
      contentType: "text/csv; charset=utf-8",
      fileName: `megadesk-${input.section}-${input.from}-${input.to}.csv`,
      content: rowsToCsv(rows.slice(0, input.maxRows)),
      rowCount: Math.min(rows.length, input.maxRows),
    };
  }
}
