/**
 * A deliberately narrow, disposable-only proof that the restored database
 * metadata still resolves to the restored private-media object through the
 * same SaleDocumentService used by the application.  It is not an HTTP route
 * and it never accepts operator-provided tenant or storage identifiers.
 */
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import { productMediaRoot } from "../../../product-media";
import { deleteCrmClientFilePhysical } from "../../crm/client-files/files-storage";
import { ErpDomainError } from "../errors";
import { SaleDocumentService } from "./documents-service";

const RESTORE_DATABASE = /^megadesk_test_restore_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const RESTORE_ENVIRONMENT = /^restore-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESTORE_MEDIA_ROOT = "/opt/megadesk/storage";

type ProbeIdentity = {
  clientId: string;
  userId: string;
  userName: string;
  role: "admin" | "viewer";
};

type ProbeFixture = {
  admin: ProbeIdentity;
  viewer: ProbeIdentity;
  otherTenant: ProbeIdentity;
  salePublicId: string;
  cleanup(): Promise<void>;
};

type UploadedDocument = { publicId: string; sha256: string };
type DownloadedDocument = { bytes: Buffer };

export class RestoreSyntheticProbeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new RestoreSyntheticProbeError(code, message);
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectDomainFailure(task: () => Promise<unknown>, expected: "FORBIDDEN" | "NOT_FOUND", label: string): Promise<void> {
  return task().then(
    () => fail("PROBE_EXPECTED_DENIAL", `${label} unexpectedly succeeded.`),
    error => {
      if (!(error instanceof ErpDomainError) || error.code !== expected) {
        fail("PROBE_UNEXPECTED_FAILURE", `${label} did not fail through the canonical access path.`);
      }
    },
  );
}

export function assertRestoreSyntheticProbeEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.MEGADESK_RESTORE_HARNESS !== "1" || environment.MEGADESK_RESTORE_PROBE !== "1") {
    fail("PROBE_ENVIRONMENT_REQUIRED", "the synthetic probe is available only to the explicit restore harness.");
  }
  if (!RESTORE_ENVIRONMENT.test(environment.MEGADESK_RESTORE_ENVIRONMENT_ID ?? "")) {
    fail("PROBE_ENVIRONMENT_REQUIRED", "the restore environment identity is invalid.");
  }
  if (environment.NODE_ENV !== "development" || environment.RUN_DATABASE_INTEGRATION !== "1") {
    fail("PROBE_ENVIRONMENT_REQUIRED", "the probe requires the disposable development runtime.");
  }
  if (!environment.TEST_DATABASE_URL || environment.DATABASE_URL !== environment.TEST_DATABASE_URL || environment.MAIN_DATABASE_URL) {
    fail("PROBE_DATABASE_UNSAFE", "the probe refuses a missing, divergent, or main database URL.");
  }
  let database: URL;
  try { database = new URL(environment.DATABASE_URL); } catch { fail("PROBE_DATABASE_UNSAFE", "the probe database URL is invalid."); }
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  if (database.protocol !== "mysql:" || database.hostname !== "mysql-test" || !RESTORE_DATABASE.test(databaseName)) {
    fail("PROBE_DATABASE_UNSAFE", "the probe accepts only the internal disposable MySQL target.");
  }
  if (environment.MEGADESK_MEDIA_ROOT !== RESTORE_MEDIA_ROOT || environment.MEGADESK_DISPOSABLE_MEDIA_ROOT !== RESTORE_MEDIA_ROOT) {
    fail("PROBE_MEDIA_UNSAFE", "the probe requires the restore harness media mount.");
  }
  for (const key of ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "BUILT_IN_FORGE_API_KEY", "BUILT_IN_FORGE_API_URL"] as const) {
    if (environment[key]) fail("PROBE_ENVIRONMENT_UNSAFE", "external-service configuration is not permitted in the probe container.");
  }
}

export type SyntheticProbeDependencies = {
  createFixture(): Promise<ProbeFixture>;
  upload(identity: ProbeIdentity, salePublicId: string, bytes: Buffer): Promise<UploadedDocument>;
  download(identity: ProbeIdentity, salePublicId: string, documentPublicId: string): Promise<DownloadedDocument>;
  removeObject(): Promise<void>;
};

/** The orchestration is separately testable; production wiring is below. */
export async function runSyntheticProbe(dependencies: SyntheticProbeDependencies): Promise<{ sha256: string }> {
  const fixture = await dependencies.createFixture();
  const bytes = Buffer.from("MegaDesk restore synthetic media probe v1\n", "utf8");
  try {
    const document = await dependencies.upload(fixture.admin, fixture.salePublicId, bytes);
    if (document.sha256 !== digest(bytes)) fail("PROBE_HASH_MISMATCH", "metadata hash differs from the synthetic object.");
    const downloaded = await dependencies.download(fixture.viewer, fixture.salePublicId, document.publicId);
    if (!downloaded.bytes.equals(bytes) || digest(downloaded.bytes) !== document.sha256) {
      fail("PROBE_HASH_MISMATCH", "the canonical read path returned bytes different from metadata.");
    }
    await expectDomainFailure(
      () => dependencies.upload(fixture.viewer, fixture.salePublicId, bytes),
      "FORBIDDEN",
      "viewer upload",
    );
    await expectDomainFailure(
      () => dependencies.download(fixture.otherTenant, fixture.salePublicId, document.publicId),
      "NOT_FOUND",
      "cross-tenant download",
    );
    await dependencies.removeObject();
    await expectDomainFailure(
      () => dependencies.download(fixture.viewer, fixture.salePublicId, document.publicId),
      "NOT_FOUND",
      "missing physical object",
    );
    return { sha256: document.sha256 };
  } finally {
    await fixture.cleanup();
  }
}

async function createFixture(): Promise<ProbeFixture> {
  const probeId = randomUUID();
  const tenant = `restore-probe-${probeId}`;
  const otherTenant = `restore-probe-other-${probeId}`;
  const crmClientId = `restore-probe-crm-${probeId}`;
  const salePublicId = randomUUID();
  const admin: ProbeIdentity = { clientId: tenant, userId: `restore-probe-admin-${probeId}`, userName: "Restore probe admin", role: "admin" };
  const viewer: ProbeIdentity = { clientId: tenant, userId: `restore-probe-viewer-${probeId}`, userName: "Restore probe viewer", role: "viewer" };
  const other: ProbeIdentity = { clientId: otherTenant, userId: `restore-probe-other-${probeId}`, userName: "Restore probe other", role: "admin" };
  const db = getPool();
  const tenants = [tenant, otherTenant];
  try {
    for (const [identity, suffix] of [[admin, "primary"], [other, "other"]] as const) {
      await db.execute(
        `INSERT INTO megadesk_domain_clients
          (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json)
         VALUES(?,?,?,?,?,'00000000000','Test','active','test',1,?,'["erp"]','{}')`,
        [identity.clientId, `${identity.clientId}-internal`, `restore_${probeId.replace(/-/g, "").slice(0, 20)}_${suffix}`, "Synthetic restore probe", "Synthetic only", `probe-${probeId}-${suffix}`],
      );
    }
    await db.execute(
      "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
      [crmClientId, tenant, "Synthetic restore probe customer"],
    );
    await db.execute(
      `INSERT INTO erp_sale_orders
        (public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,current_stage,subtotal_cents,total_cents,created_by)
       VALUES(?,?,?,?,?,'confirmed','confirmed',1,1,?)`,
      [salePublicId, tenant, `RESTORE-${probeId.slice(0, 8)}`, crmClientId, "Synthetic restore probe customer", admin.userId],
    );
  } catch (error) {
    await cleanupSyntheticProbe(tenants).catch(() => undefined);
    throw error;
  }
  return { admin, viewer, otherTenant: other, salePublicId, cleanup: () => cleanupSyntheticProbe(tenants) };
}

async function cleanupSyntheticProbe(tenants: string[]): Promise<void> {
  const db = getPool();
  for (const sql of [
    "DELETE FROM erp_sale_documents WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_client_files WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_events WHERE client_id IN (?,?)",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_document_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)",
  ]) await db.execute(sql, tenants);
  const root = path.resolve(productMediaRoot());
  for (const tenant of tenants) {
    const target = path.resolve(root, "tenants", tenant);
    if (!target.startsWith(`${root}${path.sep}tenants${path.sep}restore-probe-`)) {
      fail("PROBE_CLEANUP_UNSAFE", "refusing to clean a non-synthetic media path.");
    }
    await rm(target, { recursive: true, force: true });
  }
}

export async function runRestoreSyntheticSaleDocumentProbe(): Promise<{ sha256: string }> {
  assertRestoreSyntheticProbeEnvironment();
  const service = new SaleDocumentService();
  let storageKey = "";
  let syntheticTenant = "";
  return runSyntheticProbe({
    createFixture,
    async upload(identity, salePublicId, bytes) {
      if (identity.role === "admin") syntheticTenant = identity.clientId;
      const result = await service.upload(identity, {
        salePublicId, idempotencyKey: randomUUID(), documentType: "other", fileName: "restore-probe.txt",
        description: "Synthetic restore probe", mimeType: "text/plain", base64: bytes.toString("base64"),
      });
      const [rows] = await getPool().execute<RowDataPacket[]>(
        `SELECT f.storage_key FROM erp_sale_documents d
         INNER JOIN megadesk_crm_client_files f ON f.client_id=d.client_id AND f.id=d.client_file_id
         WHERE d.client_id=? AND d.public_id=?`,
        [identity.clientId, result.publicId],
      );
      storageKey = String(rows[0]?.storage_key ?? "");
      if (!storageKey) fail("PROBE_METADATA_MISSING", "the canonical service did not persist a media reference.");
      return result;
    },
    download: (identity, salePublicId, documentPublicId) => service.getForDownload(identity, salePublicId, documentPublicId),
    async removeObject() {
      if (!storageKey || !syntheticTenant.startsWith("restore-probe-")) {
        fail("PROBE_METADATA_MISSING", "no synthetic object was created.");
      }
      const [rows] = await getPool().execute<RowDataPacket[]>(
        "SELECT client_id FROM megadesk_crm_client_files WHERE storage_key=? AND client_id=?",
        [storageKey, syntheticTenant],
      );
      if (String(rows[0]?.client_id ?? "") !== syntheticTenant) {
        fail("PROBE_METADATA_MISSING", "the synthetic media metadata is unavailable.");
      }
      await deleteCrmClientFilePhysical(syntheticTenant, storageKey);
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRestoreSyntheticSaleDocumentProbe().then(
    result => process.stdout.write(`SYNTHETIC_RESTORE_PROBE_OK=${result.sha256}\n`),
    error => {
      const code = error instanceof RestoreSyntheticProbeError ? error.code : "PROBE_FAILED";
      process.stderr.write(`SYNTHETIC_RESTORE_PROBE_FAILED=${code}\n`);
      process.exitCode = 1;
    },
  );
}
