import { randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import { ErpDomainError } from "../errors";
import {
  internalFiscalNumber,
  payloadHash,
  productFiscalCompleteness,
  settingsStatus,
  type FiscalListInput,
  type FiscalSettingsInput,
  type ManualDocumentInput,
  type ProductFiscalProfileInput,
  type SourceDocumentInput,
  type UpdateDraftInput,
} from "./contracts";
type DocRow = RowDataPacket & {
  id: number;
  public_id: string;
  internal_number: string;
  type: "sale" | "purchase" | "manual";
  status: "draft" | "ready_for_integration" | "cancelled";
  internal_issue_date: string | Date;
  source_public_id: string | null;
  party_name_snapshot: string;
  party_document_snapshot: string | null;
  total_cents: number;
  internal_notes: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};
const dateOnly = (v: string | Date) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10),
  doc = (r: DocRow) => ({
    publicId: r.public_id,
    internalNumber: r.internal_number,
    type: r.type,
    status: r.status,
    internalIssueDate: dateOnly(r.internal_issue_date),
    sourcePublicId: r.source_public_id,
    partyName: r.party_name_snapshot,
    partyDocument: r.party_document_snapshot,
    totalCents: Number(r.total_cents),
    internalNotes: r.internal_notes,
    cancellationReason: r.cancellation_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
export class FiscalRepository {
  constructor(private pool?: Pool) {}
  private db() {
    return (this.pool ??= getPool());
  }
  async settings(clientId: string) {
    const [r] = await this.db().execute<RowDataPacket[]>(
      "SELECT public_id publicId,tax_regime taxRegime,taxpayer_indicator taxpayerIndicator,state_registration stateRegistration,municipal_registration municipalRegistration,main_cnae mainCnae,ibge_city_code ibgeCityCode,environment,provider,status,created_at createdAt,updated_at updatedAt FROM erp_fiscal_settings WHERE client_id=? LIMIT 1",
      [clientId]
    );
    return r[0] ?? null;
  }
  async saveSettings(
    clientId: string,
    userId: string,
    input: FiscalSettingsInput
  ) {
    const c = await this.db().getConnection(),
      status = settingsStatus(input);
    try {
      await c.beginTransaction();
      const [old] = await c.execute<RowDataPacket[]>(
        "SELECT id,public_id FROM erp_fiscal_settings WHERE client_id=? LIMIT 1 FOR UPDATE",
        [clientId]
      );
      const operation = old[0] ? ("updated" as const) : ("created" as const),
        publicId = old[0] ? String(old[0].public_id) : randomUUID();
      if (old[0])
        await c.execute(
          "UPDATE erp_fiscal_settings SET tax_regime=?,taxpayer_indicator=?,state_registration=?,municipal_registration=?,main_cnae=?,ibge_city_code=?,environment=?,provider='none',status=?,updated_by=? WHERE client_id=?",
          [
            input.taxRegime,
            input.taxpayerIndicator,
            input.stateRegistration,
            input.municipalRegistration,
            input.mainCnae,
            input.ibgeCityCode,
            input.environment,
            status,
            userId,
            clientId,
          ]
        );
      else
        await c.execute(
          "INSERT INTO erp_fiscal_settings(public_id,client_id,tax_regime,taxpayer_indicator,state_registration,municipal_registration,main_cnae,ibge_city_code,environment,provider,status,updated_by) VALUES(?,?,?,?,?,?,?,?,?,'none',?,?)",
          [
            publicId,
            clientId,
            input.taxRegime,
            input.taxpayerIndicator,
            input.stateRegistration,
            input.municipalRegistration,
            input.mainCnae,
            input.ibgeCityCode,
            input.environment,
            status,
            userId,
          ]
        );
      const [row] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_fiscal_settings WHERE client_id=?",
        [clientId]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_settings_history(client_id,settings_id,operation,status,changed_fields,changed_by) VALUES(?,?,?,?,?,?)",
        [
          clientId,
          row[0].id,
          operation,
          status,
          JSON.stringify([
            "taxRegime",
            "taxpayerIndicator",
            "registrations",
            "classifications",
            "environment",
          ]),
          userId,
        ]
      );
      await c.commit();
      return { publicId, status, operation };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async products(
    clientId: string,
    o: { search: string; incomplete?: boolean; page: number; pageSize: number }
  ) {
    const where = ["p.client_id=?"],
      values: any[] = [clientId];
    if (o.search) {
      where.push("(p.name LIKE ? OR p.sku LIKE ?)");
      values.push(`%${o.search}%`, `%${o.search}%`);
    }
    if (o.incomplete)
      where.push("(f.id IS NULL OR f.completeness='incomplete')");
    const joins =
        " LEFT JOIN erp_product_fiscal_profiles f ON f.product_id=p.id AND f.client_id=p.client_id",
      limit = Math.max(1, Math.min(100, o.pageSize)),
      offset = (Math.max(1, o.page) - 1) * limit;
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_products p${joins} WHERE ${where.join(" AND ")}`,
      values
    );
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT p.public_id productPublicId,p.name,p.sku,p.barcode,f.public_id publicId,f.ncm,f.cest,f.default_outbound_cfop defaultOutboundCfop,f.default_inbound_cfop defaultInboundCfop,f.goods_origin goodsOrigin,COALESCE(f.fiscal_unit,p.unit) fiscalUnit,COALESCE(f.gtin,p.barcode) gtin,f.service_code serviceCode,f.operation_nature operationNature,f.internal_notes internalNotes,COALESCE(f.completeness,'incomplete') completeness FROM erp_products p${joins} WHERE ${where.join(" AND ")} ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: rows,
      total: Number(count[0]?.total ?? 0),
      totalPages: Math.ceil(Number(count[0]?.total ?? 0) / limit),
    };
  }
  async saveProduct(
    clientId: string,
    userId: string,
    input: ProductFiscalProfileInput
  ) {
    const c = await this.db().getConnection(),
      complete = productFiscalCompleteness(input);
    try {
      await c.beginTransaction();
      const [products] = await c.execute<RowDataPacket[]>(
        "SELECT id,unit,barcode FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1 FOR UPDATE",
        [clientId, input.productPublicId]
      );
      if (!products[0])
        throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
      const [old] = await c.execute<RowDataPacket[]>(
        "SELECT public_id FROM erp_product_fiscal_profiles WHERE client_id=? AND product_id=?",
        [clientId, products[0].id]
      );
      const publicId = old[0] ? String(old[0].public_id) : randomUUID(),
        args = [
          input.ncm,
          input.cest,
          input.defaultOutboundCfop,
          input.defaultInboundCfop,
          input.goodsOrigin,
          input.fiscalUnit,
          input.gtin ?? products[0].barcode,
          input.serviceCode,
          input.operationNature,
          input.internalNotes,
          complete,
          userId,
          clientId,
          products[0].id,
        ];
      if (old[0])
        await c.execute(
          "UPDATE erp_product_fiscal_profiles SET ncm=?,cest=?,default_outbound_cfop=?,default_inbound_cfop=?,goods_origin=?,fiscal_unit=?,gtin=?,service_code=?,operation_nature=?,internal_notes=?,completeness=?,updated_by=? WHERE client_id=? AND product_id=?",
          args
        );
      else
        await c.execute(
          "INSERT INTO erp_product_fiscal_profiles(public_id,ncm,cest,default_outbound_cfop,default_inbound_cfop,goods_origin,fiscal_unit,gtin,service_code,operation_nature,internal_notes,completeness,updated_by,client_id,product_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [publicId, ...args]
        );
      await c.commit();
      return {
        publicId,
        productPublicId: input.productPublicId,
        completeness: complete,
      };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  private async nextNumber(c: PoolConnection, clientId: string, year: number) {
    await c.execute(
      "INSERT INTO erp_fiscal_document_sequences(client_id,year,next_number) VALUES(?,?,1) ON DUPLICATE KEY UPDATE client_id=VALUES(client_id)",
      [clientId, year]
    );
    const [rows] = await c.execute<RowDataPacket[]>(
      "SELECT next_number FROM erp_fiscal_document_sequences WHERE client_id=? AND year=? FOR UPDATE",
      [clientId, year]
    );
    const n = Number(rows[0].next_number);
    await c.execute(
      "UPDATE erp_fiscal_document_sequences SET next_number=next_number+1 WHERE client_id=? AND year=?",
      [clientId, year]
    );
    return internalFiscalNumber(year, n);
  }
  private async replay(
    c: PoolConnection,
    clientId: string,
    key: string,
    hash: string
  ) {
    const [rows] = await c.execute<RowDataPacket[]>(
      "SELECT o.payload_hash,d.public_id FROM erp_fiscal_operations o INNER JOIN erp_fiscal_documents d ON d.id=o.fiscal_document_id AND d.client_id=o.client_id WHERE o.client_id=? AND o.idempotency_key=? LIMIT 1",
      [clientId, key]
    );
    if (!rows[0]) return null;
    if (rows[0].payload_hash !== hash)
      throw new ErpDomainError(
        "IDEMPOTENCY_CONFLICT",
        "Chave idempotente usada com outra operação."
      );
    return String(rows[0].public_id);
  }
  private async insertItems(
    c: PoolConnection,
    clientId: string,
    documentId: number,
    items: Array<{
      productPublicId?: string | null;
      name: string;
      sku?: string | null;
      quantityMillis: number;
      unitAmountCents: number;
      lineTotalCents: number;
      fiscal?: unknown;
    }>
  ) {
    for (const x of items)
      await c.execute(
        "INSERT INTO erp_fiscal_document_items(public_id,client_id,fiscal_document_id,product_public_id,product_name_snapshot,sku_snapshot,quantity_millis,unit_amount_cents,line_total_cents,fiscal_profile_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          clientId,
          documentId,
          x.productPublicId ?? null,
          x.name,
          x.sku ?? null,
          x.quantityMillis,
          x.unitAmountCents,
          x.lineTotalCents,
          x.fiscal ? JSON.stringify(x.fiscal) : null,
        ]
      );
  }
  async createSource(
    clientId: string,
    userId: string,
    input: SourceDocumentInput
  ) {
    const c = await this.db().getConnection(),
      hash = payloadHash(input);
    try {
      await c.beginTransaction();
      const replay = await this.replay(c, clientId, input.idempotencyKey, hash);
      if (replay) {
        await c.commit();
        return {
          document: (await this.detail(clientId, replay))!,
          replay: true,
        };
      }
      const sale = input.type === "sale",
        table = sale ? "erp_sale_orders" : "erp_purchase_orders",
        itemTable = sale ? "erp_sale_order_items" : "erp_purchase_order_items",
        orderFk = sale ? "sale_order_id" : "purchase_order_id",
        expected = sale ? "fulfilled" : "received",
        sourceJoin = sale
          ? "INNER JOIN megadesk_crm_clients mc ON mc.crm_client_id=o.crm_client_id AND mc.client_id=o.client_id"
          : "INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id";
      const [source] = await c.execute<RowDataPacket[]>(
        `SELECT o.id,o.total_cents,o.status,${sale ? "o.customer_name_snapshot party_name,mc.cpf_cnpj party_document" : "o.supplier_name_snapshot party_name,s.tax_id party_document"} FROM ${table} o ${sourceJoin} WHERE o.client_id=? AND o.public_id=? LIMIT 1 FOR UPDATE`,
        [clientId, input.sourcePublicId]
      );
      if (!source[0])
        throw new ErpDomainError("NOT_FOUND", "Origem não encontrada.");
      if (source[0].status !== expected)
        throw new ErpDomainError("CONFLICT", `Origem deve estar ${expected}.`);
      const [items] = await c.execute<RowDataPacket[]>(
        `SELECT p.public_id product_public_id,i.product_name_snapshot name,i.sku_snapshot sku,CAST(i.quantity*1000 AS SIGNED) quantity_millis,${sale ? "i.unit_price_cents" : "i.unit_cost_cents"} unit_amount_cents,i.line_total_cents,f.ncm,f.cest,f.default_outbound_cfop,f.default_inbound_cfop,f.goods_origin,f.fiscal_unit,f.gtin FROM ${itemTable} i INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=? LEFT JOIN erp_product_fiscal_profiles f ON f.product_id=p.id AND f.client_id=p.client_id WHERE i.${orderFk}=?`,
        [clientId, source[0].id]
      );
      const [expectedItems] = await c.execute<RowDataPacket[]>(
        `SELECT COUNT(*) total FROM ${itemTable} WHERE ${orderFk}=?`,
        [source[0].id]
      );
      if (!items.length || items.length !== Number(expectedItems[0]?.total))
        throw new ErpDomainError(
          "CONFLICT",
          "Origem com itens inconsistentes."
        );
      const year = Number(input.internalIssueDate.slice(0, 4)),
        number = await this.nextNumber(c, clientId, year),
        publicId = randomUUID();
      const [created] = await c.execute<ResultSetHeader>(
        "INSERT INTO erp_fiscal_documents(public_id,client_id,internal_number,type,status,internal_issue_date,source_public_id,party_name_snapshot,party_document_snapshot,total_cents,internal_notes,created_by,updated_by) VALUES(?,?,?,?,'draft',?,?,?,?,?,?,?,?)",
        [
          publicId,
          clientId,
          number,
          input.type,
          input.internalIssueDate,
          input.sourcePublicId,
          source[0].party_name,
          source[0].party_document,
          Number(source[0].total_cents),
          input.internalNotes,
          userId,
          userId,
        ]
      );
      await this.insertItems(
        c,
        clientId,
        created.insertId,
        items.map(x => ({
          productPublicId: x.product_public_id,
          name: x.name,
          sku: x.sku,
          quantityMillis: Number(x.quantity_millis),
          unitAmountCents: Number(x.unit_amount_cents),
          lineTotalCents: Number(x.line_total_cents),
          fiscal: {
            ncm: x.ncm,
            cest: x.cest,
            defaultOutboundCfop: x.default_outbound_cfop,
            defaultInboundCfop: x.default_inbound_cfop,
            goodsOrigin: x.goods_origin,
            fiscalUnit: x.fiscal_unit,
            gtin: x.gtin,
          },
        }))
      );
      await c.execute(
        "INSERT INTO erp_fiscal_document_history(client_id,fiscal_document_id,to_status,changed_by) VALUES(?,?,'draft',?)",
        [clientId, created.insertId, userId]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_operations(client_id,idempotency_key,operation,fiscal_document_id,payload_hash) VALUES(?,?,'create_source',?,?)",
        [clientId, input.idempotencyKey, created.insertId, hash]
      );
      await c.commit();
      return {
        document: (await this.detail(clientId, publicId))!,
        replay: false,
      };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async createManual(
    clientId: string,
    userId: string,
    input: ManualDocumentInput
  ) {
    const c = await this.db().getConnection(),
      hash = payloadHash(input);
    try {
      await c.beginTransaction();
      const replay = await this.replay(c, clientId, input.idempotencyKey, hash);
      if (replay) {
        await c.commit();
        return {
          document: (await this.detail(clientId, replay))!,
          replay: true,
        };
      }
      const total = input.items.reduce(
          (n, x) =>
            n + Math.round((x.quantityMillis * x.unitAmountCents) / 1000),
          0
        ),
        number = await this.nextNumber(
          c,
          clientId,
          Number(input.internalIssueDate.slice(0, 4))
        ),
        publicId = randomUUID();
      const [created] = await c.execute<ResultSetHeader>(
        "INSERT INTO erp_fiscal_documents(public_id,client_id,internal_number,type,status,internal_issue_date,party_name_snapshot,party_document_snapshot,total_cents,internal_notes,created_by,updated_by) VALUES(?,?,?,'manual','draft',?,?,?,?,?,?,?)",
        [
          publicId,
          clientId,
          number,
          input.internalIssueDate,
          input.partyName,
          input.partyDocument,
          total,
          input.internalNotes,
          userId,
          userId,
        ]
      );
      await this.insertItems(
        c,
        clientId,
        created.insertId,
        input.items.map(x => ({
          ...x,
          lineTotalCents: Math.round(
            (x.quantityMillis * x.unitAmountCents) / 1000
          ),
        }))
      );
      await c.execute(
        "INSERT INTO erp_fiscal_document_history(client_id,fiscal_document_id,to_status,changed_by) VALUES(?,?,'draft',?)",
        [clientId, created.insertId, userId]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_operations(client_id,idempotency_key,operation,fiscal_document_id,payload_hash) VALUES(?,?,'create_manual',?,?)",
        [clientId, input.idempotencyKey, created.insertId, hash]
      );
      await c.commit();
      return {
        document: (await this.detail(clientId, publicId))!,
        replay: false,
      };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async list(clientId: string, o: FiscalListInput) {
    const where = ["client_id=?"],
      v: any[] = [clientId];
    if (o.type) {
      where.push("type=?");
      v.push(o.type);
    }
    if (o.status) {
      where.push("status=?");
      v.push(o.status);
    }
    if (o.source)
      where.push(
        o.source === "manual"
          ? "source_public_id IS NULL"
          : "source_public_id IS NOT NULL"
      );
    if (o.from) {
      where.push("internal_issue_date>=?");
      v.push(o.from);
    }
    if (o.to) {
      where.push("internal_issue_date<=?");
      v.push(o.to);
    }
    if (o.search) {
      where.push("(internal_number LIKE ? OR party_name_snapshot LIKE ?)");
      v.push(`%${o.search}%`, `%${o.search}%`);
    }
    const limit = o.pageSize,
      offset = (o.page - 1) * limit,
      sort = {
        issueDate: "internal_issue_date",
        number: "internal_number",
        createdAt: "created_at",
        total: "total_cents",
      }[o.sort];
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_fiscal_documents WHERE ${where.join(" AND ")}`,
      v
    );
    const [rows] = await this.db().execute<DocRow[]>(
      `SELECT * FROM erp_fiscal_documents WHERE ${where.join(" AND ")} ORDER BY ${sort} ${o.direction === "asc" ? "ASC" : "DESC"},id DESC LIMIT ${limit} OFFSET ${offset}`,
      v
    );
    return { items: rows.map(doc), total: Number(count[0]?.total ?? 0) };
  }
  async detail(
    clientId: string,
    publicId: string,
    db: Pool | PoolConnection = this.db(),
    lock = false
  ) {
    const [rows] = await db.execute<DocRow[]>(
      `SELECT * FROM erp_fiscal_documents WHERE client_id=? AND public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    if (!rows[0]) return null;
    const [items] = await db.execute<RowDataPacket[]>(
      "SELECT public_id publicId,product_public_id productPublicId,product_name_snapshot name,sku_snapshot sku,quantity_millis quantityMillis,unit_amount_cents unitAmountCents,line_total_cents lineTotalCents,fiscal_profile_snapshot fiscalProfile FROM erp_fiscal_document_items WHERE client_id=? AND fiscal_document_id=? ORDER BY id",
      [clientId, rows[0].id]
    );
    const [history] = await db.execute<RowDataPacket[]>(
      "SELECT from_status fromStatus,to_status toStatus,reason,created_at createdAt FROM erp_fiscal_document_history WHERE client_id=? AND fiscal_document_id=? ORDER BY id",
      [clientId, rows[0].id]
    );
    return {
      ...doc(rows[0]),
      items: items.map(x => ({
        ...x,
        quantityMillis: Number(x.quantityMillis),
        unitAmountCents: Number(x.unitAmountCents),
        lineTotalCents: Number(x.lineTotalCents),
        fiscalProfile: x.fiscalProfile
          ? JSON.parse(String(x.fiscalProfile))
          : null,
      })),
      history: history.map(x => ({
        ...x,
        createdAt:
          x.createdAt instanceof Date
            ? x.createdAt.toISOString()
            : String(x.createdAt),
      })),
    };
  }
  async updateDraft(clientId: string, userId: string, input: UpdateDraftInput) {
    const c = await this.db().getConnection();
    try {
      await c.beginTransaction();
      const d = await this.detail(clientId, input.publicId, c, true);
      if (!d)
        throw new ErpDomainError("NOT_FOUND", "Documento não encontrado.");
      if (d.status !== "draft")
        throw new ErpDomainError("CONFLICT", "Documento encerrado é imutável.");
      await c.execute(
        "UPDATE erp_fiscal_documents SET internal_issue_date=?,internal_notes=?,updated_by=? WHERE client_id=? AND public_id=?",
        [
          input.internalIssueDate,
          input.internalNotes,
          userId,
          clientId,
          input.publicId,
        ]
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    return this.detail(clientId, input.publicId);
  }
  async ready(clientId: string, userId: string, id: string, key: string) {
    const c = await this.db().getConnection(),
      hash = payloadHash({ id, key, operation: "ready" });
    try {
      await c.beginTransaction();
      const replay = await this.replay(c, clientId, key, hash);
      if (replay) {
        if (replay !== id)
          throw new ErpDomainError(
            "IDEMPOTENCY_CONFLICT",
            "Chave usada em outro documento."
          );
        await c.commit();
        return { document: (await this.detail(clientId, id))!, replay: true };
      }
      const d = await this.detail(clientId, id, c, true);
      if (!d)
        throw new ErpDomainError("NOT_FOUND", "Documento não encontrado.");
      if (d.status !== "draft")
        throw new ErpDomainError(
          "CONFLICT",
          "Somente rascunho pode ser preparado para integração."
        );
      const [row] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_fiscal_documents WHERE client_id=? AND public_id=?",
        [clientId, id]
      );
      await c.execute(
        "UPDATE erp_fiscal_documents SET status='ready_for_integration',updated_by=? WHERE client_id=? AND public_id=?",
        [userId, clientId, id]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_document_history(client_id,fiscal_document_id,from_status,to_status,changed_by) VALUES(?,?,'draft','ready_for_integration',?)",
        [clientId, row[0].id, userId]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_operations(client_id,idempotency_key,operation,fiscal_document_id,payload_hash) VALUES(?,?,'ready',?,?)",
        [clientId, key, row[0].id, hash]
      );
      await c.commit();
      return { document: (await this.detail(clientId, id))!, replay: false };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async cancel(clientId: string, userId: string, id: string, reason: string) {
    const c = await this.db().getConnection();
    try {
      await c.beginTransaction();
      const d = await this.detail(clientId, id, c, true);
      if (!d)
        throw new ErpDomainError("NOT_FOUND", "Documento não encontrado.");
      if (d.status === "cancelled")
        throw new ErpDomainError("CONFLICT", "Documento já cancelado.");
      const [row] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_fiscal_documents WHERE client_id=? AND public_id=?",
        [clientId, id]
      );
      await c.execute(
        "UPDATE erp_fiscal_documents SET status='cancelled',cancelled_at=NOW(),cancelled_by=?,cancellation_reason=?,updated_by=? WHERE client_id=? AND public_id=?",
        [userId, reason, userId, clientId, id]
      );
      await c.execute(
        "INSERT INTO erp_fiscal_document_history(client_id,fiscal_document_id,from_status,to_status,reason,changed_by) VALUES(?, ?,?,'cancelled',?,?)",
        [clientId, row[0].id, d.status, reason, userId]
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    return this.detail(clientId, id);
  }
  async summary(clientId: string) {
    const [r] = await this.db().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total,SUM(status='draft') drafts,SUM(status='ready_for_integration') ready,SUM(status='cancelled') cancelled FROM erp_fiscal_documents WHERE client_id=?",
      [clientId]
    );
    const [p] = await this.db().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total,SUM(f.id IS NULL OR f.completeness='incomplete') incomplete FROM erp_products p LEFT JOIN erp_product_fiscal_profiles f ON f.product_id=p.id AND f.client_id=p.client_id WHERE p.client_id=?",
      [clientId]
    );
    return {
      documents: Number(r[0]?.total ?? 0),
      drafts: Number(r[0]?.drafts ?? 0),
      ready: Number(r[0]?.ready ?? 0),
      cancelled: Number(r[0]?.cancelled ?? 0),
      products: Number(p[0]?.total ?? 0),
      incompleteProducts: Number(p[0]?.incomplete ?? 0),
      settings: await this.settings(clientId),
      electronicIssuanceConfigured: false,
    };
  }
}
