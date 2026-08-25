import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { ReportFilter, ReportSection } from "./contracts";
type Row = RowDataPacket & Record<string, unknown>;
export class ReportsRepository {
  constructor(private pool?: Pool) {}
  private db() {
    return (this.pool ??= getPool());
  }
  private async rows(sql: string, values: unknown[]) {
    const [rows] = await this.db().query<Row[]>(sql, values);
    return rows.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "bigint" ? Number(v) : v,
        ])
      )
    );
  }
  private page(f: ReportFilter) {
    return [f.pageSize, (f.page - 1) * f.pageSize] as const;
  }
  private pagination(f: ReportFilter, total: unknown, items: Array<Record<string, unknown>>) {
    const count = Number(total ?? 0);
    return { items, page: f.page, pageSize: f.pageSize, total: count, totalPages: Math.ceil(count / f.pageSize) };
  }
  private numeric(row: Record<string, unknown> | undefined) {
    return Object.fromEntries(
      Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
    );
  }
  private order(section: Exclude<ReportSection, "executive">, f: ReportFilter) {
    const columns: Record<Exclude<ReportSection, "executive">, Record<string, string>> = {
      sales: { number: "order_number", date: "created_at", total: "total_cents", customer: "customer_name_snapshot" },
      purchases: { number: "po.order_number", date: "po.created_at", total: "po.total_cents", supplier: "po.supplier_name_snapshot" },
      stock: { product: "p.name", sku: "p.sku", quantity: "quantityMillis", movement: "movementMillis" },
      finance: { dueDate: "e.due_date", amount: "e.amount_cents", status: "e.status", party: "COALESCE(e.party_name_snapshot,'')" },
      clients: { name: "c.company_name", createdAt: "c.created_at", salesTotal: "valueCents" },
      suppliers: { name: "s.legal_name", createdAt: "s.created_at", purchasesTotal: "valueCents" },
      fiscal: { number: "internal_number", date: "internal_issue_date", status: "status", origin: "type" },
    };
    const defaults = { sales: "date", purchases: "date", stock: "movement", finance: "dueDate", clients: "salesTotal", suppliers: "purchasesTotal", fiscal: "date" } as const;
    const column = columns[section][f.sort ?? defaults[section]] ?? columns[section][defaults[section]];
    return `${column} ${f.direction === "asc" ? "ASC" : "DESC"}, id ASC`;
  }
  async executive(clientId: string, f: ReportFilter) {
    const values = [clientId, f.from, f.to];
    const [sales, purchases, finance, settled, accounts, entities, fiscal] =
      await Promise.all([
        this.rows(
          "SELECT COUNT(*) count,COALESCE(SUM(total_cents),0) valueCents FROM erp_sale_orders WHERE client_id=? AND status='fulfilled' AND DATE(fulfilled_at) BETWEEN ? AND ?",
          values
        ),
        this.rows(
          "SELECT COUNT(*) count,COALESCE(SUM(total_cents),0) valueCents FROM erp_purchase_orders WHERE client_id=? AND status='received' AND DATE(received_at) BETWEEN ? AND ?",
          values
        ),
        this.rows(
          "SELECT SUM(status='open') openTitles,SUM(direction='receivable' AND status='open') openReceivables,SUM(direction='payable' AND status='open') openPayables FROM erp_financial_entries WHERE client_id=?",
          [clientId]
        ),
        this.rows(
          "SELECT COALESCE(SUM(CASE WHEN direction='receivable' AND status='settled' AND DATE(settled_at) BETWEEN ? AND ? THEN amount_cents ELSE 0 END),0) receivedCents,COALESCE(SUM(CASE WHEN direction='payable' AND status='settled' AND DATE(settled_at) BETWEEN ? AND ? THEN amount_cents ELSE 0 END),0) paidCents FROM erp_financial_entries WHERE client_id=?",
          [f.from, f.to, f.from, f.to, clientId]
        ),
        this.rows(
          "SELECT COALESCE(SUM(current_balance_cents),0) balanceCents FROM erp_financial_accounts WHERE client_id=? AND active=1",
          [clientId]
        ),
        this.rows(
          "SELECT (SELECT COUNT(*) FROM erp_products WHERE client_id=? AND active=1) activeProducts,(SELECT COUNT(*) FROM erp_products p LEFT JOIN erp_stock_balances b ON b.product_id=p.id AND b.client_id=p.client_id WHERE p.client_id=? AND p.active=1 AND COALESCE(b.quantity,0)<p.minimum_stock) lowStock,(SELECT COUNT(*) FROM megadesk_crm_clients WHERE client_id=? AND status='ativo') activeClients,(SELECT COUNT(*) FROM erp_suppliers WHERE client_id=? AND active=1) activeSuppliers",
          [clientId, clientId, clientId, clientId]
        ),
        this.rows(
          "SELECT SUM(status='draft') drafts,SUM(status='ready_for_integration') ready,SUM(status='cancelled') cancelled FROM erp_fiscal_documents WHERE client_id=?",
          [clientId]
        ),
      ]);
    return {
      sales: this.numeric(sales[0]),
      purchases: this.numeric(purchases[0]),
      finance: this.numeric(finance[0]),
      settlements: this.numeric(settled[0]),
      accounts: this.numeric(accounts[0]),
      entities: this.numeric(entities[0]),
      fiscal: this.numeric(fiscal[0]),
    };
  }
  async sales(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f),
      v = [clientId, f.from, f.to], order = this.order("sales", f);
    const [byStatus, topProducts, rows, total] = await Promise.all([
      this.rows(
        "SELECT status,COUNT(*) count,COALESCE(SUM(total_cents),0) valueCents FROM erp_sale_orders WHERE client_id=? AND DATE(created_at) BETWEEN ? AND ? GROUP BY status",
        v
      ),
      this.rows(
        "SELECT i.product_name_snapshot name,CAST(SUM(i.quantity)*1000 AS SIGNED) quantityMillis,SUM(i.line_total_cents) valueCents FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id=? AND o.status='fulfilled' AND DATE(o.fulfilled_at) BETWEEN ? AND ? GROUP BY i.product_id,i.product_name_snapshot ORDER BY quantityMillis DESC LIMIT 10",
        v
      ),
      this.rows(
        `SELECT public_id publicId,order_number number,customer_name_snapshot name,status,total_cents valueCents,DATE_FORMAT(created_at,'%Y-%m-%d') date FROM erp_sale_orders WHERE client_id=? AND DATE(created_at) BETWEEN ? AND ? AND (? IS NULL OR status=?) AND (? IS NULL OR crm_client_id=?) ORDER BY ${order} LIMIT ? OFFSET ?`,
        [
          clientId,
          f.from,
          f.to,
          f.status ?? null,
          f.status ?? null,
          f.publicId ?? null,
          f.publicId ?? null,
          l,
          o,
        ]
      ), this.rows("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id=? AND DATE(created_at) BETWEEN ? AND ? AND (? IS NULL OR status=?) AND (? IS NULL OR crm_client_id=?)", [clientId,f.from,f.to,f.status??null,f.status??null,f.publicId??null,f.publicId??null]),
    ]);
    const completed = byStatus.find(x => x.status === "fulfilled");
    return {
      summary: {
        fulfilledCount: Number(completed?.count ?? 0),
        fulfilledValueCents: Number(completed?.valueCents ?? 0),
        averageTicketCents:
          Number(completed?.count ?? 0) > 0
            ? Math.round(
                Number(completed?.valueCents ?? 0) / Number(completed?.count)
              )
            : 0,
      },
      byStatus,
      topProducts,
      ...this.pagination(f, total[0]?.total, rows),
    };
  }
  async purchases(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f),
      v = [clientId, f.from, f.to], order = this.order("purchases", f);
    const [byStatus, topProducts, rows, total] = await Promise.all([
      this.rows(
        "SELECT status,COUNT(*) count,COALESCE(SUM(total_cents),0) valueCents FROM erp_purchase_orders WHERE client_id=? AND DATE(created_at) BETWEEN ? AND ? GROUP BY status",
        v
      ),
      this.rows(
        "SELECT i.product_name_snapshot name,CAST(SUM(i.quantity)*1000 AS SIGNED) quantityMillis,SUM(i.line_total_cents) valueCents FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id=? AND o.status='received' AND DATE(o.received_at) BETWEEN ? AND ? GROUP BY i.product_id,i.product_name_snapshot ORDER BY quantityMillis DESC LIMIT 10",
        v
      ),
      this.rows(
        `SELECT po.public_id publicId,po.order_number number,po.supplier_name_snapshot name,po.status,po.total_cents valueCents,DATE_FORMAT(po.created_at,'%Y-%m-%d') date FROM erp_purchase_orders po LEFT JOIN erp_suppliers s ON s.id=po.supplier_id AND s.client_id=po.client_id WHERE po.client_id=? AND DATE(po.created_at) BETWEEN ? AND ? AND (? IS NULL OR po.status=?) AND (? IS NULL OR s.public_id=?) ORDER BY ${order.replace(/, id ASC$/, ", po.id ASC")} LIMIT ? OFFSET ?`,
        [
          clientId,
          f.from,
          f.to,
          f.status ?? null,
          f.status ?? null,
          f.publicId ?? null,
          f.publicId ?? null,
          l,
          o,
        ]
      ), this.rows("SELECT COUNT(*) total FROM erp_purchase_orders po LEFT JOIN erp_suppliers s ON s.id=po.supplier_id AND s.client_id=po.client_id WHERE po.client_id=? AND DATE(po.created_at) BETWEEN ? AND ? AND (? IS NULL OR po.status=?) AND (? IS NULL OR s.public_id=?)", [clientId,f.from,f.to,f.status??null,f.status??null,f.publicId??null,f.publicId??null]),
    ]);
    const received = byStatus.find(x => x.status === "received");
    return {
      summary: {
        receivedCount: Number(received?.count ?? 0),
        receivedValueCents: Number(received?.valueCents ?? 0),
        averageTicketCents:
          Number(received?.count ?? 0) > 0
            ? Math.round(
                Number(received?.valueCents ?? 0) / Number(received?.count)
              )
            : 0,
      },
      byStatus,
      topProducts,
      ...this.pagination(f, total[0]?.total, rows),
    };
  }
  async stock(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f), order = this.order("stock", f);
    const [summary, byType, rows, total] = await Promise.all([
      this.rows(
        "SELECT SUM(COALESCE(b.quantity,0)=0) zeroStock,SUM(COALESCE(b.quantity,0)<p.minimum_stock) lowStock FROM erp_products p LEFT JOIN erp_stock_balances b ON b.product_id=p.id AND b.client_id=p.client_id WHERE p.client_id=? AND p.active=1",
        [clientId]
      ),
      this.rows(
        "SELECT type,direction,CAST(SUM(quantity)*1000 AS SIGNED) quantityMillis,COUNT(*) count FROM erp_stock_movements WHERE client_id=? AND DATE(created_at) BETWEEN ? AND ? GROUP BY type,direction",
        [clientId, f.from, f.to]
      ),
      this.rows(
        `SELECT p.public_id publicId,p.name,p.sku,CAST(COALESCE(b.quantity,0)*1000 AS SIGNED) quantityMillis,CAST(p.minimum_stock*1000 AS SIGNED) minimumMillis,CAST(COALESCE(SUM(CASE WHEN DATE(m.created_at) BETWEEN ? AND ? THEN m.quantity*1000 ELSE 0 END),0) AS SIGNED) movementMillis FROM erp_products p LEFT JOIN erp_stock_balances b ON b.product_id=p.id AND b.client_id=p.client_id LEFT JOIN erp_stock_movements m ON m.product_id=p.id AND m.client_id=p.client_id WHERE p.client_id=? AND (? IS NULL OR p.public_id=?) GROUP BY p.id,b.quantity ORDER BY ${order.replace(/, id ASC$/, ", p.id ASC")} LIMIT ? OFFSET ?`,
        [f.from, f.to, clientId, f.publicId ?? null, f.publicId ?? null, l, o]
      ), this.rows("SELECT COUNT(*) total FROM erp_products p WHERE p.client_id=? AND (? IS NULL OR p.public_id=?)", [clientId,f.publicId??null,f.publicId??null]),
    ]);
    return { summary: this.numeric(summary[0]), byType, ...this.pagination(f, total[0]?.total, rows) };
  }
  async finance(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f), order = this.order("finance", f);
    const [summary, byCategory, accounts, ledger, rows, total] = await Promise.all([
      this.rows(
        "SELECT SUM(direction='payable' AND status='open') openPayable,SUM(direction='receivable' AND status='open') openReceivable,SUM(status='open' AND due_date<CURRENT_DATE) overdue,SUM(status='open' AND due_date>=CURRENT_DATE) upcoming FROM erp_financial_entries WHERE client_id=?",
        [clientId]
      ),
      this.rows(
        "SELECT c.name,SUM(e.amount_cents) valueCents,COUNT(*) count FROM erp_financial_entries e INNER JOIN erp_financial_categories c ON c.id=e.category_id AND c.client_id=e.client_id WHERE e.client_id=? AND e.status<>'cancelled' AND e.issue_date BETWEEN ? AND ? GROUP BY c.id,c.name ORDER BY valueCents DESC",
        [clientId, f.from, f.to]
      ),
      this.rows(
        "SELECT public_id publicId,name,current_balance_cents balanceCents FROM erp_financial_accounts WHERE client_id=? AND active=1 ORDER BY name",
        [clientId]
      ),
      this.rows(
        "SELECT type,SUM(amount_cents) valueCents,COUNT(*) count FROM erp_financial_ledger WHERE client_id=? AND DATE(occurred_at) BETWEEN ? AND ? GROUP BY type",
        [clientId, f.from, f.to]
      ),
      this.rows(
        `SELECT e.public_id publicId,e.document_number number,e.party_name_snapshot party,e.direction,e.status,e.amount_cents valueCents,DATE_FORMAT(e.due_date,'%Y-%m-%d') date,c.name category,a.name account FROM erp_financial_entries e INNER JOIN erp_financial_categories c ON c.id=e.category_id AND c.client_id=e.client_id LEFT JOIN erp_financial_accounts a ON a.id=e.financial_account_id AND a.client_id=e.client_id WHERE e.client_id=? AND e.issue_date BETWEEN ? AND ? AND (? IS NULL OR e.status=?) AND (? IS NULL OR c.public_id=? OR a.public_id=?) ORDER BY ${order.replace(/, id ASC$/, ", e.id ASC")} LIMIT ? OFFSET ?`,
        [
          clientId,
          f.from,
          f.to,
          f.status ?? null,
          f.status ?? null,
          f.publicId ?? null,
          f.publicId ?? null,
          f.publicId ?? null,
          l,
          o,
        ]
      ), this.rows("SELECT COUNT(*) total FROM erp_financial_entries e INNER JOIN erp_financial_categories c ON c.id=e.category_id AND c.client_id=e.client_id LEFT JOIN erp_financial_accounts a ON a.id=e.financial_account_id AND a.client_id=e.client_id WHERE e.client_id=? AND e.issue_date BETWEEN ? AND ? AND (? IS NULL OR e.status=?) AND (? IS NULL OR c.public_id=? OR a.public_id=?)", [clientId,f.from,f.to,f.status??null,f.status??null,f.publicId??null,f.publicId??null,f.publicId??null]),
    ]);
    return { summary: this.numeric(summary[0]), byCategory, accounts, ledger, ...this.pagination(f, total[0]?.total, rows) };
  }
  async clients(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f), order = this.order("clients", f);
    const [summary, rows, total] = await Promise.all([
      this.rows(
        "SELECT SUM(status='ativo') activeClients,SUM(created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)) newClients FROM megadesk_crm_clients WHERE client_id=?",
        [f.from, f.to, clientId]
      ),
      this.rows(
        `SELECT c.crm_client_id publicId,c.company_name name,c.status,COUNT(s.id) orderCount,COALESCE(SUM(CASE WHEN s.status='fulfilled' THEN s.total_cents ELSE 0 END),0) valueCents,MAX(DATE(s.created_at)) lastOrder FROM megadesk_crm_clients c LEFT JOIN erp_sale_orders s ON s.crm_client_id=c.crm_client_id AND s.client_id=c.client_id AND DATE(s.created_at) BETWEEN ? AND ? WHERE c.client_id=? AND (? IS NULL OR c.crm_client_id=?) GROUP BY c.crm_client_id,c.company_name,c.status,c.created_at ORDER BY ${order.replace(/, id ASC$/, ", c.crm_client_id ASC")} LIMIT ? OFFSET ?`,
        [f.from, f.to, clientId, f.publicId ?? null, f.publicId ?? null, l, o]
      ), this.rows("SELECT COUNT(*) total FROM megadesk_crm_clients c WHERE c.client_id=? AND (? IS NULL OR c.crm_client_id=?)", [clientId,f.publicId??null,f.publicId??null]),
    ]);
    return { summary: this.numeric(summary[0]), ...this.pagination(f, total[0]?.total, rows) };
  }
  async suppliers(clientId: string, f: ReportFilter) {
    const [l, o] = this.page(f), order = this.order("suppliers", f);
    const [summary, rows, total] = await Promise.all([
      this.rows(
        "SELECT SUM(active=1) activeSuppliers,SUM(created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)) newSuppliers FROM erp_suppliers WHERE client_id=?",
        [f.from, f.to, clientId]
      ),
      this.rows(
        `SELECT s.public_id publicId,s.legal_name name,s.active,COUNT(po.id) orderCount,COALESCE(SUM(CASE WHEN po.status='received' THEN po.total_cents ELSE 0 END),0) valueCents,MAX(DATE(po.created_at)) lastOrder FROM erp_suppliers s LEFT JOIN erp_purchase_orders po ON po.supplier_id=s.id AND po.client_id=s.client_id AND DATE(po.created_at) BETWEEN ? AND ? WHERE s.client_id=? AND (? IS NULL OR s.public_id=?) GROUP BY s.id ORDER BY ${order.replace(/, id ASC$/, ", s.id ASC")} LIMIT ? OFFSET ?`,
        [f.from, f.to, clientId, f.publicId ?? null, f.publicId ?? null, l, o]
      ), this.rows("SELECT COUNT(*) total FROM erp_suppliers s WHERE s.client_id=? AND (? IS NULL OR s.public_id=?)", [clientId,f.publicId??null,f.publicId??null]),
    ]);
    return { summary: this.numeric(summary[0]), ...this.pagination(f, total[0]?.total, rows) };
  }
  async fiscal(clientId: string, f: ReportFilter) {
    const [l,o] = this.page(f), order = this.order("fiscal", f);
    const [byStatus, byOrigin, incomplete, rows, total] = await Promise.all([
      this.rows(
        "SELECT status,COUNT(*) count FROM erp_fiscal_documents WHERE client_id=? AND internal_issue_date BETWEEN ? AND ? AND (? IS NULL OR status=?) GROUP BY status",
        [clientId, f.from, f.to, f.status ?? null, f.status ?? null]
      ),
      this.rows(
        "SELECT type origin,COUNT(*) count FROM erp_fiscal_documents WHERE client_id=? AND internal_issue_date BETWEEN ? AND ? GROUP BY type",
        [clientId, f.from, f.to]
      ),
      this.rows(
        "SELECT (SELECT COUNT(*) FROM erp_products p LEFT JOIN erp_product_fiscal_profiles fp ON fp.product_id=p.id AND fp.client_id=p.client_id WHERE p.client_id=? AND (fp.id IS NULL OR fp.completeness='incomplete')) incompleteProducts,(SELECT COUNT(*) FROM erp_fiscal_settings WHERE client_id=? AND status='incomplete') incompleteSettings",
        [clientId, clientId]
      ),
      this.rows(`SELECT public_id publicId,internal_number number,DATE_FORMAT(internal_issue_date,'%Y-%m-%d') date,status,type origin FROM erp_fiscal_documents WHERE client_id=? AND internal_issue_date BETWEEN ? AND ? AND (? IS NULL OR status=?) ORDER BY ${order} LIMIT ? OFFSET ?`, [clientId,f.from,f.to,f.status??null,f.status??null,l,o]),
      this.rows("SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND internal_issue_date BETWEEN ? AND ? AND (? IS NULL OR status=?)", [clientId,f.from,f.to,f.status??null,f.status??null]),
    ]);
    return { summary: incomplete[0], byStatus, byOrigin, ...this.pagination(f, total[0]?.total, rows) };
  }
  async report(
    clientId: string,
    section: ReportSection,
    f: ReportFilter
  ): Promise<unknown> {
    return section === "executive"
      ? this.executive(clientId, f)
      : this[section](clientId, f);
  }
}
