import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCanonicalMigrations, MAIN_MIGRATIONS_DIR } from "../../_core/canonical-migrations";
import { getPool } from "../../db";
import { getTestDatabaseUrl, isTestDatabaseEnabled } from "../../test-integration-gates";
import { ErpRepository } from "./repository";
import { ErpService } from "./service";

const physical = describe.runIf(isTestDatabaseEnabled());
const service = new ErpService(new ErpRepository());
const adminA = { clientId:"erp-test-a",userId:"erp-admin-a",role:"admin" as const };
const adminB = { clientId:"erp-test-b",userId:"erp-admin-b",role:"admin" as const };
const product = { name:"Produto físico",sku:"sku físico",barcode:null,description:null,category:"Teste",unit:"unit" as const,costPriceCents:1250,salePriceCents:2000,minimumStock:"2" };

async function clean() {
  await getPool().execute("DELETE FROM erp_stock_movements WHERE client_id IN ('erp-test-a','erp-test-b')");
  await getPool().execute("DELETE FROM erp_stock_balances WHERE client_id IN ('erp-test-a','erp-test-b')");
  await getPool().execute("DELETE FROM erp_products WHERE client_id IN ('erp-test-a','erp-test-b')");
}

physical("ERP physical MySQL invariants", () => {
  beforeAll(async () => { await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR); await clean(); });
  afterAll(clean);
  it("installs the clean canonical migration and isolates duplicate SKU by tenant", async () => { const a=await service.createProduct(adminA,product); const b=await service.createProduct(adminB,product); expect(a.publicId).not.toBe(b.publicId); await expect(service.createProduct(adminA,product)).rejects.toMatchObject({code:"CONFLICT"}); });
  it("persists empty barcode as null", async () => { const item=await service.createProduct(adminA,{...product,sku:"NULL-BARCODE"}); expect(item.barcode).toBeNull(); });
  it("writes balance and ledger atomically and replays an identical key", async () => { const item=await service.createProduct(adminA,{...product,sku:"LEDGER"}); const key=crypto.randomUUID(); const first=await service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"5.500",reason:"Entrada física",idempotencyKey:key}); const replay=await service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"5.500",reason:"Entrada física",idempotencyKey:key}); expect(replay.publicId).toBe(first.publicId); expect((await service.getProduct(adminA,item.publicId)).quantity).toBe("5.500"); });
  it("rejects a reused key with a different payload", async () => { const item=await service.createProduct(adminA,{...product,sku:"IDEMPOTENCY"}); const key=crypto.randomUUID(); await service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"1",reason:"Entrada física",idempotencyKey:key}); await expect(service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"2",reason:"Entrada física",idempotencyKey:key})).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"}); });
  it("rolls back an insufficient output without a ledger row", async () => { const item=await service.createProduct(adminA,{...product,sku:"ROLLBACK"}); await expect(service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_out",quantity:"1",reason:"Saída física",idempotencyKey:crypto.randomUUID()})).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"}); expect((await service.listMovements(adminA,{productPublicId:item.publicId,page:1,pageSize:20})).total).toBe(0); });
  it("serializes concurrent outputs", async () => { const item=await service.createProduct(adminA,{...product,sku:"CONCURRENT"}); await service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"1",reason:"Saldo inicial",idempotencyKey:crypto.randomUUID()}); const results=await Promise.allSettled([1,2].map(()=>service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_out",quantity:"1",reason:"Saída concorrente",idempotencyKey:crypto.randomUUID()}))); expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1); expect((await service.getProduct(adminA,item.publicId)).quantity).toBe("0.000"); });
  it("creates one immutable reversal and blocks a duplicate", async () => { const item=await service.createProduct(adminA,{...product,sku:"REVERSAL"}); const movement=await service.moveStock(adminA,{productPublicId:item.publicId,type:"manual_in",quantity:"3",reason:"Entrada reversível",idempotencyKey:crypto.randomUUID()}); await service.reverseMovement(adminA,movement.publicId,"Correção física",crypto.randomUUID()); await expect(service.reverseMovement(adminA,movement.publicId,"Correção repetida",crypto.randomUUID())).rejects.toMatchObject({code:"ALREADY_REVERSED"}); expect((await service.getProduct(adminA,item.publicId)).quantity).toBe("0.000"); });
  it("keeps summaries isolated", async () => { const summaryA=await service.summary(adminA); const summaryB=await service.summary(adminB); expect(summaryA.metrics.activeProducts).toBeGreaterThan(summaryB.metrics.activeProducts); });
});
