import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { SupplierInput, SupplierListInput } from "./contracts";

export type SupplierRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  legal_name: string;
  trade_name: string | null;
  person_type: "legal" | "individual";
  tax_id: string | null;
  state_registration: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  address_complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
};

const values = (input: SupplierInput) => [
  input.legalName,
  input.tradeName,
  input.personType,
  input.taxId,
  input.stateRegistration,
  input.email,
  input.phone,
  input.contactName,
  input.postalCode,
  input.street,
  input.addressNumber,
  input.addressComplement,
  input.district,
  input.city,
  input.state,
  input.notes,
];

export class SupplierRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  async list(clientId: string, options: SupplierListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["s.client_id=?"];
    const parameters: Array<string | number> = [clientId];
    if (options.search) {
      const raw = `%${options.search}%`;
      const digits = options.search.replace(/\D/g, "");
      conditions.push("(s.legal_name LIKE ? OR s.trade_name LIKE ? OR s.tax_id LIKE ? OR s.email LIKE ?)");
      parameters.push(raw, raw, `%${digits || options.search}%`, raw);
    }
    if (options.active !== undefined) {
      conditions.push("s.active=?");
      parameters.push(options.active ? 1 : 0);
    }
    if (options.city) {
      conditions.push("s.city=?");
      parameters.push(options.city.trim());
    }
    if (options.state) {
      conditions.push("s.state=?");
      parameters.push(options.state.toUpperCase());
    }
    const where = conditions.join(" AND ");
    const order = options.sort === "createdAt" ? "s.created_at" : "s.legal_name";
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total, SUM(s.active=1) activeCount, SUM(s.active=0) inactiveCount FROM erp_suppliers s WHERE ${where}`,
      parameters
    );
    const [rows] = await this.database().execute<SupplierRow[]>(
      `SELECT s.*,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_updated.name, u_updated.email) AS updated_by_name
       FROM erp_suppliers s
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id = s.client_id AND u_created.user_id = s.created_by
       LEFT JOIN megadesk_domain_client_users u_updated ON u_updated.client_id = s.client_id AND u_updated.user_id = s.updated_by
       WHERE ${where}
       ORDER BY ${order} ${options.direction === "desc" ? "DESC" : "ASC"}, s.id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );
    return {
      items: rows,
      total: Number(countRows[0]?.total ?? 0),
      activeCount: Number(countRows[0]?.activeCount ?? 0),
      inactiveCount: Number(countRows[0]?.inactiveCount ?? 0),
    };
  }

  async find(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<SupplierRow | null> {
    const [rows] = await connection.execute<SupplierRow[]>(
      `SELECT s.*,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_updated.name, u_updated.email) AS updated_by_name
       FROM erp_suppliers s
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id = s.client_id AND u_created.user_id = s.created_by
       LEFT JOIN megadesk_domain_client_users u_updated ON u_updated.client_id = s.client_id AND u_updated.user_id = s.updated_by
       WHERE s.client_id=? AND s.public_id=?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findByTaxId(clientId: string, taxId: string, excludePublicId?: string): Promise<SupplierRow | null> {
    const parameters = excludePublicId ? [clientId, taxId, excludePublicId] : [clientId, taxId];
    const exclusion = excludePublicId ? " AND s.public_id<>?" : "";
    const [rows] = await this.database().execute<SupplierRow[]>(
      `SELECT s.*,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_updated.name, u_updated.email) AS updated_by_name
       FROM erp_suppliers s
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id = s.client_id AND u_created.user_id = s.created_by
       LEFT JOIN megadesk_domain_client_users u_updated ON u_updated.client_id = s.client_id AND u_updated.user_id = s.updated_by
       WHERE s.client_id=? AND s.tax_id=?${exclusion}
       LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async create(clientId: string, userId: string, publicId: string, input: SupplierInput): Promise<SupplierRow> {
    const connection = await this.database().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO erp_suppliers(public_id,client_id,legal_name,trade_name,person_type,tax_id,state_registration,email,phone,contact_name,postal_code,street,address_number,address_complement,district,city,state,notes,active,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
        [publicId, clientId, ...values(input), userId]
      );
      const row = await this.find(clientId, publicId, connection);
      if (!row) throw new Error("Supplier insert unavailable");
      await connection.commit();
      return row;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async update(clientId: string, publicId: string, userId: string, input: SupplierInput): Promise<SupplierRow | null> {
    const connection = await this.database().getConnection();
    try {
      await connection.beginTransaction();
      const current = await this.find(clientId, publicId, connection, true);
      if (!current) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        "UPDATE erp_suppliers SET legal_name=?,trade_name=?,person_type=?,tax_id=?,state_registration=?,email=?,phone=?,contact_name=?,postal_code=?,street=?,address_number=?,address_complement=?,district=?,city=?,state=?,notes=?,updated_by=? WHERE client_id=? AND public_id=?",
        [...values(input), userId, clientId, publicId]
      );
      const row = await this.find(clientId, publicId, connection);
      if (!row) throw new Error("Supplier update unavailable");
      await connection.commit();
      return row;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async setActive(clientId: string, publicId: string, userId: string, active: boolean): Promise<boolean> {
    const connection = await this.database().getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE erp_suppliers SET active=?,updated_by=? WHERE client_id=? AND public_id=?",
        [active ? 1 : 0, userId, clientId, publicId]
      );
      if (result.affectedRows === 0) {
        await connection.rollback();
        return false;
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
