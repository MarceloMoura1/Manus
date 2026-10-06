import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import {
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { productMediaRoot } from "../../../product-media";
import { ClientFileRepository } from "../../crm/client-files/files-repository";
import { ClientFileService } from "../../crm/client-files/files-service";
import {
  deleteCrmClientFilePhysical,
  readCrmClientFile,
  writeCrmClientFileAtomic,
} from "../../crm/client-files/files-storage";
import { SaleDocumentRepository } from "./documents-repository";
import { SaleDocumentService } from "./documents-service";

const physical = describe.runIf(isTestDatabaseEnabled());
const adminA = {
  clientId: "sale-doc-a",
  userId: "sale-doc-admin-a",
  userName: "Admin Documento A",
  role: "admin" as const,
};
const viewerA = {
  ...adminA,
  userId: "sale-doc-viewer-a",
  userName: "Viewer Documento A",
  role: "viewer" as const,
};
const adminB = {
  clientId: "sale-doc-b",
  userId: "sale-doc-admin-b",
  userName: "Admin Documento B",
  role: "admin" as const,
};
const tenants = [adminA.clientId, adminB.clientId];
const textBytes = Buffer.from("Documento comercial sintético MegaDesk\n", "utf8");
let mediaRoot = "";
let serial = 0;

class FailOnceFinalizeRepository extends SaleDocumentRepository {
  private fail = true;

  override async finalizeUpload(
    clientId: string,
    salePublicId: string,
    documentPublicId: string
  ) {
    if (this.fail) {
      this.fail = false;
      throw new Error("controlled finalize failure after physical write");
    }
    return super.finalizeUpload(clientId, salePublicId, documentPublicId);
  }
}

async function clean(): Promise<void> {
  const db = getPool();
  for (const sql of [
    "DELETE FROM erp_sale_documents WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_client_files WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_events WHERE client_id IN (?,?)",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)",
  ]) {
    await db.execute(sql, tenants);
  }
  const canonicalRoot = path.resolve(mediaRoot);
  for (const tenant of tenants) {
    const tenantFiles = path.resolve(
      canonicalRoot,
      "tenants",
      tenant,
      "crm-client-files"
    );
    if (!tenantFiles.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new Error("Caminho de cleanup físico fora do storage temporário.");
    }
    await rm(tenantFiles, { recursive: true, force: true });
  }
}

async function count(sql: string, args: unknown[] = []): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, args);
  return Number(rows[0]?.total ?? 0);
}

async function physicalFileCount(): Promise<number> {
  try {
    const entries = await readdir(mediaRoot, { recursive: true, withFileTypes: true });
    return entries.filter(entry => entry.isFile() && entry.name.endsWith(".bin")).length;
  } catch {
    return 0;
  }
}

async function fixture(identity = adminA) {
  const current = ++serial;
  const crmClientId = `crm-doc-${identity.clientId}-${current}`;
  const salePublicId = crypto.randomUUID();
  await getPool().execute(
    `INSERT INTO megadesk_domain_clients
     (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json)
     VALUES(?,?,?,?,?,'00000000000','Test','active','test',1,?,'["erp"]','{}')`,
    [
      identity.clientId,
      `${identity.clientId}-internal`,
      `mdsk_${identity.clientId.replace(/-/g, "_")}`,
      `Tenant documento ${identity.clientId}`,
      "Fixture",
      `synthetic-${identity.clientId}`,
    ]
  );
  await getPool().execute(
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
    [crmClientId, identity.clientId, `Cliente documento ${current}`]
  );
  await getPool().execute(
    `INSERT INTO erp_sale_orders
     (public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,current_stage,subtotal_cents,total_cents,created_by)
     VALUES(?,?,?,?,?,'confirmed','confirmed',12500,12500,?)`,
    [
      salePublicId,
      identity.clientId,
      `VD-DOC-${current}`,
      crmClientId,
      `Cliente documento ${current}`,
      identity.userId,
    ]
  );
  return { crmClientId, salePublicId };
}

function upload(
  salePublicId: string,
  documentType: "invoice" | "content_declaration" | "other" = "invoice",
  idempotencyKey = crypto.randomUUID()
) {
  return {
    salePublicId,
    idempotencyKey,
    documentType,
    fileName: `${documentType}.txt`,
    description: `Documento ${documentType}`,
    mimeType: "text/plain",
    base64: textBytes.toString("base64"),
  };
}

physical.sequential("ERP sale documents MySQL + filesystem matrix", () => {
  beforeAll(async () => {
    mediaRoot = productMediaRoot();
    await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR);
  });
  beforeEach(clean);
  afterAll(clean);

  it("uploads one physical object, replays idempotently and downloads exact bytes", async () => {
    const f = await fixture();
    const service = new SaleDocumentService();
    const command = upload(f.salePublicId, "invoice");
    const created = await service.upload(adminA, command);
    const replay = await service.upload(adminA, command);
    expect(replay.publicId).toBe(created.publicId);
    expect(replay.filePublicId).toBe(created.filePublicId);
    expect(await physicalFileCount()).toBe(1);
    const downloaded = await service.getForDownload(
      viewerA,
      f.salePublicId,
      created.publicId
    );
    expect(downloaded.bytes).toEqual(textBytes);
    expect(downloaded.mimeType).toBe("text/plain");
    expect(await service.list(viewerA, f.salePublicId)).toHaveLength(1);
    await expect(service.upload(viewerA, upload(f.salePublicId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.list(adminB, f.salePublicId)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.getForDownload(adminB, f.salePublicId, created.publicId)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recovers pending_upload after physical write without a duplicate object", async () => {
    const f = await fixture();
    const repository = new FailOnceFinalizeRepository();
    const service = new SaleDocumentService(repository);
    const command = upload(f.salePublicId, "content_declaration");
    await expect(service.upload(adminA, command)).rejects.toThrow(
      "controlled finalize failure"
    );
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_documents WHERE client_id=? AND state='pending_upload'",
        [adminA.clientId]
      )
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM megadesk_crm_client_files WHERE client_id=? AND state='pending_upload'",
        [adminA.clientId]
      )
    ).toBe(1);
    expect(await physicalFileCount()).toBe(1);
    const recovered = await service.upload(adminA, command);
    expect(recovered.state).toBe("active");
    expect(await physicalFileCount()).toBe(1);
    await expect(
      service.upload(adminA, { ...command, fileName: "conteudo-divergente.txt" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps pending_delete on physical failure, blocks generic removal and converges on retry", async () => {
    const f = await fixture();
    let failDelete = true;
    const service = new SaleDocumentService(new SaleDocumentRepository(), {
      write: writeCrmClientFileAtomic,
      read: readCrmClientFile,
      delete: async (clientId, storageKey) => {
        if (failDelete) {
          failDelete = false;
          throw new Error("controlled physical delete failure");
        }
        await deleteCrmClientFilePhysical(clientId, storageKey);
      },
    });
    const created = await service.upload(adminA, upload(f.salePublicId, "other"));
    const clientFiles = new ClientFileService();
    await expect(
      clientFiles.delete(adminA, {
        crmClientId: f.crmClientId,
        filePublicId: created.filePublicId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.delete(adminA, {
        salePublicId: f.salePublicId,
        documentPublicId: created.publicId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [states] = await getPool().execute<RowDataPacket[]>(
      `SELECT d.state document_state,f.state file_state
       FROM erp_sale_documents d
       INNER JOIN megadesk_crm_client_files f ON f.client_id=d.client_id AND f.id=d.client_file_id
       WHERE d.client_id=? AND d.public_id=?`,
      [adminA.clientId, created.publicId]
    );
    expect(states[0]).toMatchObject({
      document_state: "pending_delete",
      file_state: "pending_delete",
    });
    expect(await physicalFileCount()).toBe(1);
    expect(
      await new ClientFileRepository().listEligiblePhysicalCleanup(
        adminA.clientId,
        100
      )
    ).toHaveLength(0);
    await expect(
      clientFiles.delete(adminA, {
        crmClientId: f.crmClientId,
        filePublicId: created.filePublicId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await service.delete(adminA, {
      salePublicId: f.salePublicId,
      documentPublicId: created.publicId,
    });
    expect(await physicalFileCount()).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_documents WHERE client_id=? AND public_id=? AND state='deleted'",
        [adminA.clientId, created.publicId]
      )
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_events WHERE client_id=? AND event_type='document_removed'",
        [adminA.clientId]
      )
    ).toBe(1);
  });

  it("serializes simultaneous sale removals without duplicate audit or leaked file", async () => {
    const f = await fixture();
    const service = new SaleDocumentService();
    const created = await service.upload(adminA, upload(f.salePublicId, "invoice"));
    const command = {
      salePublicId: f.salePublicId,
      documentPublicId: created.publicId,
    };
    const outcomes = await Promise.allSettled([
      service.delete(adminA, command),
      service.delete(adminA, command),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(await physicalFileCount()).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_events WHERE client_id=? AND event_type='document_removed'",
        [adminA.clientId]
      )
    ).toBe(1);
  });

  it("shows all categories once in customer sales and preserves history on archive", async () => {
    const f = await fixture();
    const service = new SaleDocumentService();
    for (const type of ["invoice", "content_declaration", "other"] as const) {
      await service.upload(adminA, upload(f.salePublicId, type));
    }
    const customerSales = await service.customerSales(adminA, f.crmClientId);
    expect(customerSales.sales).toHaveLength(1);
    expect(customerSales.sales[0].documents).toHaveLength(3);
    expect(
      new Set(customerSales.sales[0].documents.map(document => document.documentType))
    ).toEqual(new Set(["invoice", "content_declaration", "other"]));
    expect(await physicalFileCount()).toBe(3);
    await getPool().execute(
      "UPDATE megadesk_crm_clients SET lifecycle_state='archived',archived_at=NOW() WHERE client_id=? AND crm_client_id=?",
      [adminA.clientId, f.crmClientId]
    );
    expect((await service.customerSales(adminA, f.crmClientId)).sales[0].documents).toHaveLength(3);
    await expect(
      service.upload(adminA, upload(f.salePublicId, "other"))
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects invalid physical content before reserving metadata", async () => {
    const f = await fixture();
    const service = new SaleDocumentService();
    await expect(
      service.upload(adminA, {
        ...upload(f.salePublicId),
        mimeType: "text/plain",
        base64: Buffer.from("<script>alert(1)</script>", "utf8").toString("base64"),
      })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_documents WHERE client_id=?",
        [adminA.clientId]
      )
    ).toBe(0);
    expect(await physicalFileCount()).toBe(0);
  });
});
