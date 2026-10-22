import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const repository = readFileSync("server/modules/erp/sales/documents-repository.ts", "utf8");
const service = readFileSync("server/modules/erp/sales/documents-service.ts", "utf8");
const clientFiles = readFileSync("server/modules/crm/client-files/files-service.ts", "utf8");
const clientFileRepository = readFileSync("server/modules/crm/client-files/files-repository.ts", "utf8");
const migration = readFileSync("drizzle/main-migrations/0038_quick_lenny_balinger.sql", "utf8");
const salesPage = readFileSync("client/src/pages/erp/SalesPage.tsx", "utf8");
const clientsPage = readFileSync("client/src/pages/ClientesPage.tsx", "utf8");

describe("sales Delivery D architecture", () => {
  it("stores one private CRM file and links it to the tenant-scoped sale", () => {
    expect(repository).toContain("INSERT INTO megadesk_crm_client_files");
    expect(repository).toContain("INSERT INTO erp_sale_documents");
    expect(repository).toContain("c.client_id=o.client_id");
    expect(repository).toContain("o.client_id=? AND o.public_id=?");
    expect(repository).toContain("f.client_id=d.client_id AND f.id=d.client_file_id");
    expect(repository).toContain("item_order.client_id=? AND item_order.id=i.sale_order_id");
    expect(service).toContain("writeCrmClientFileAtomic");
    expect(service).not.toContain("writeFile(");
  });

  it("implements retryable two-phase upload and deletion and prevents bypass from client files", () => {
    expect(repository).toContain("reserveUpload");
    expect(repository).toContain("finalizeUpload");
    expect(repository).toContain("state='pending_upload'");
    expect(repository).toContain("upload_idempotency_key");
    expect(repository).toContain("upload_payload_hash");
    expect(repository).toContain("findPendingUploadByPayloadWith");
    expect(repository).toContain("state='pending_delete'");
    expect(repository).toContain("state='deleted'");
    expect(repository).toContain("pending_delete_at=NOW()");
    expect(repository).toContain("document_removed");
    expect(service).toContain("deleteCrmClientFilePhysical");
    expect(clientFiles).toContain("hasActiveSaleDocumentLink");
    expect(clientFiles).toContain("deve ser removido pelo pedido correspondente");
    expect(clientFileRepository).toContain("NOT EXISTS");
    expect(clientFileRepository).toContain("d.client_file_id=f.id AND d.state <> 'deleted'");
  });

  it("keeps 0038 additive and tenant-aware", () => {
    expect(migration).toContain("CREATE TABLE `erp_sale_documents`");
    expect(migration).toContain("uq_mccf_tenant_id");
    expect(migration).toContain("fk_erp_sale_document_order");
    expect(migration).toContain("fk_erp_sale_document_client_file");
    expect(migration).toContain("uq_erp_sale_documents_tenant_upload_key");
    expect(migration).toContain("enum('active','pending_delete','deleted','pending_upload')");
    expect(migration).not.toMatch(/(?:^|statement-breakpoint\s*)(?:DROP|TRUNCATE|DELETE|RENAME)\b/i);
  });

  it("provides real sale documents, customer sales and bidirectional navigation", () => {
    expect(salesPage).toContain("SaleDocuments");
    expect(salesPage).toContain("onClientNavigate");
    expect(clientsPage).toContain("ClientSalesTab");
    expect(clientsPage).toContain("customerSales");
    expect(clientsPage).toContain("onSaleNavigate");
    expect(clientsPage).toContain("sale.documents.map");
  });
});
