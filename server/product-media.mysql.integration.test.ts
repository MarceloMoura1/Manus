import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { ProductMediaService } from "./product-media";

const enabled=process.env.RUN_PRODUCT_MEDIA_MYSQL==="1";
const suite=enabled?describe:describe.skip;
suite("product media physical lifecycle",()=>{
  const url=process.env.PRODUCT_MEDIA_DATABASE_URL!; const root=process.env.MEGADESK_MEDIA_ROOT!; let pool:ReturnType<typeof mysql.createPool>; let service:ProductMediaService;
  const a={tenantId:"synthetic-tenant-a",userId:"synthetic-user",role:"admin"}; const b={tenantId:"synthetic-tenant-b",userId:"synthetic-user",role:"admin"};
  const productPublicId="11111111-1111-4111-8111-111111111111";
  const mediaId="77777777-7777-4777-8777-777777777777";
  const storageKey=`objects/77/${mediaId}.webp`;const thumbnailKey=`thumbnails/77/${mediaId}.webp`;
  const original=()=>path.join(root,...storageKey.split("/"));const thumbnail=()=>path.join(root,...thumbnailKey.split("/"));
  async function resetRaceFixture(state:"staged"|"pending_delete"="staged"){
    await pool.execute("UPDATE erp_products SET primary_media_id=NULL WHERE client_id=? AND public_id=?",[a.tenantId,productPublicId]);
    await pool.execute("DELETE FROM erp_product_media WHERE client_id=?",[a.tenantId]);
    const [products]=await pool.execute<any[]>("SELECT id FROM erp_products WHERE client_id=? AND public_id=?",[a.tenantId,productPublicId]);
    await pool.execute("INSERT INTO erp_product_media(media_id,client_id,product_id,storage_key,thumbnail_storage_key,mime_type,byte_size,sha256,width,height,state,client_attempt_id,created_by,created_at,pending_delete_at) VALUES(?,?,?,?,?,'image/webp',1,REPEAT('7',64),1,1,?,?,?,DATE_SUB(NOW(),INTERVAL 2 DAY),IF(?='pending_delete',DATE_SUB(NOW(),INTERVAL 2 DAY),NULL))",[mediaId,a.tenantId,products[0].id,storageKey,thumbnailKey,state,randomUUID(),a.userId,state]);
    await mkdir(path.dirname(original()),{recursive:true});await mkdir(path.dirname(thumbnail()),{recursive:true});await writeFile(original(),"original");await writeFile(thumbnail(),"thumbnail");
    return products[0].id as number;
  }
  async function activate(connection:any,productId:number){
    await connection.beginTransaction();
    try{await connection.execute("SELECT id,primary_media_id FROM erp_products WHERE id=? AND client_id=? FOR UPDATE",[productId,a.tenantId]);const [rows]=await connection.execute<any[]>("SELECT id,state FROM erp_product_media WHERE media_id=? AND client_id=? FOR UPDATE",[mediaId,a.tenantId]);if(rows[0]?.state!=="staged")throw new Error(`ACTIVATION_REJECTED_${rows[0]?.state}`);await connection.execute("UPDATE erp_products SET primary_media_id=? WHERE id=? AND client_id=?",[rows[0].id,productId,a.tenantId]);const [result]=await connection.execute<any>("UPDATE erp_product_media SET state='active',activated_at=NOW() WHERE id=? AND client_id=? AND state='staged'",[rows[0].id,a.tenantId]);if(result.affectedRows!==1)throw new Error("ACTIVATION_REJECTED_STATE");await connection.commit();}catch(error){await connection.rollback();throw error;}
  }
  async function observeLockWait(){for(let attempt=0;attempt<100;attempt++){const [rows]=await pool.execute<any[]>("SELECT COUNT(*) total FROM performance_schema.data_lock_waits");if(Number(rows[0].total)>0)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error("LOCK_WAIT_NOT_OBSERVED");}
  beforeAll(async()=>{pool=mysql.createPool(url);service=new ProductMediaService(pool,root);await pool.execute("DELETE FROM erp_product_media");await pool.execute("DELETE FROM erp_products WHERE client_id IN ('synthetic-tenant-a','synthetic-tenant-b')");await pool.execute("INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by) VALUES('11111111-1111-4111-8111-111111111111','synthetic-tenant-a','Legacy product','LEGACY-001','unit',0,0,0,1,'synthetic-user'),('22222222-2222-4222-8222-222222222222','synthetic-tenant-b','Other tenant','OTHER-001','unit',0,0,0,1,'synthetic-user')");});
  afterAll(async()=>{await pool.end();});
  it("serializes replacement and replays a concurrent attempt",async()=>{const png=await sharp({create:{width:80,height:60,channels:3,background:"red"}}).png().toBuffer();const jpg=await sharp({create:{width:90,height:70,channels:3,background:"blue"}}).jpeg().toBuffer();const first=await service.upload(a,"11111111-1111-4111-8111-111111111111",randomUUID(),png);const attempt=randomUUID();const replay=await Promise.all([service.upload(a,"11111111-1111-4111-8111-111111111111",attempt,jpg),service.upload(a,"11111111-1111-4111-8111-111111111111",attempt,jpg)]);expect(replay[0]).toEqual(replay[1]);expect(replay[0].mediaId).not.toBe(first.mediaId);const [rows]=await pool.execute<any[]>("SELECT SUM(state='active') active,SUM(state='pending_delete') pending FROM erp_product_media WHERE client_id='synthetic-tenant-a'");expect(Number(rows[0].active)).toBe(1);expect(Number(rows[0].pending)).toBe(1);});
  it("isolates tenants, removes logically and reconciles only unreferenced media",async()=>{
    const [visible]=await pool.execute<any[]>("SELECT p.primary_media_id,m.id,m.state,m.client_id media_client,p.client_id product_client,m.product_id media_product_id,p.id product_id FROM erp_products p LEFT JOIN erp_product_media m ON m.id=p.primary_media_id WHERE p.client_id='synthetic-tenant-a'");
    expect(visible[0]).toMatchObject({state:"active",media_client:"synthetic-tenant-a",product_client:"synthetic-tenant-a"});expect(visible[0].media_product_id).toBe(visible[0].product_id);
    const own=await service.read(a.tenantId,"11111111-1111-4111-8111-111111111111",true);
    expect(own.mimeType).toBe("image/webp");
    await expect(service.read(b.tenantId,"11111111-1111-4111-8111-111111111111",true)).rejects.toHaveProperty("code","NOT_FOUND");
    await service.remove(a,"11111111-1111-4111-8111-111111111111");
    const result=await service.reconcile(-1_000,100);
    expect(result.deleted).toBeGreaterThanOrEqual(2);
  });
  it("rolls back valid metadata changes after a deterministic failure and preserves constraints and wa tables",async()=>{
    const [products]=await pool.execute<any[]>("SELECT id,primary_media_id FROM erp_products WHERE client_id='synthetic-tenant-a' AND public_id='11111111-1111-4111-8111-111111111111'");
    const product=products[0];
    await pool.execute("INSERT INTO erp_product_media(media_id,client_id,product_id,storage_key,thumbnail_storage_key,mime_type,byte_size,sha256,width,height,state,client_attempt_id,created_by) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic-tenant-a',?,'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp','thumbnails/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp','image/webp',1,REPEAT('a',64),1,1,'staged','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-user')",[product.id]);
    const [mediaBeforeRows]=await pool.execute<any[]>("SELECT id,state,activated_at FROM erp_product_media WHERE client_id='synthetic-tenant-a' AND media_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
    const mediaBefore=mediaBeforeRows[0];
    const [countBeforeRows]=await pool.execute<any[]>("SELECT COUNT(*) total FROM erp_product_media WHERE client_id='synthetic-tenant-a'");

    const c=await pool.getConnection();
    try{
      await c.beginTransaction();
      await c.execute("UPDATE erp_product_media SET state='active',activated_at=NOW() WHERE id=? AND client_id='synthetic-tenant-a'",[mediaBefore.id]);
      await c.execute("UPDATE erp_products SET primary_media_id=? WHERE id=? AND client_id='synthetic-tenant-a'",[mediaBefore.id,product.id]);
      await expect(c.execute("INSERT INTO erp_product_media(media_id,client_id,product_id,storage_key,thumbnail_storage_key,mime_type,byte_size,sha256,width,height,state,client_attempt_id,created_by) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','synthetic-tenant-a',?,'objects/cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp','thumbnails/cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp','image/webp',1,REPEAT('c',64),1,1,'staged','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-user')",[product.id])).rejects.toMatchObject({code:"ER_DUP_ENTRY"});
      await c.rollback();
    }catch(error){await c.rollback();throw error;}finally{c.release();}

    const [productAfterRows]=await pool.execute<any[]>("SELECT primary_media_id FROM erp_products WHERE id=? AND client_id='synthetic-tenant-a'",[product.id]);
    const [mediaAfterRows]=await pool.execute<any[]>("SELECT state,activated_at FROM erp_product_media WHERE id=? AND client_id='synthetic-tenant-a'",[mediaBefore.id]);
    const [countAfterRows]=await pool.execute<any[]>("SELECT COUNT(*) total FROM erp_product_media WHERE client_id='synthetic-tenant-a'");
    expect(productAfterRows[0].primary_media_id).toBe(product.primary_media_id);
    expect(mediaAfterRows[0]).toEqual({state:mediaBefore.state,activated_at:mediaBefore.activated_at});
    expect(Number(countAfterRows[0].total)).toBe(Number(countBeforeRows[0].total));

    const fk=await pool.getConnection();
    try{
      await fk.beginTransaction();
      await expect(fk.execute("UPDATE erp_products SET primary_media_id=999999 WHERE id=? AND client_id='synthetic-tenant-a'",[product.id])).rejects.toMatchObject({code:"ER_NO_REFERENCED_ROW_2"});
      await fk.rollback();
    }finally{fk.release();}

    for(const table of ["wa_accounts","wa_conversations","wa_messages"]){const [rows]=await pool.execute<any[]>(`SELECT COUNT(*) total FROM ${table}`);expect(Number(rows[0].total)).toBe(0);}
  });
  it("proves reactivation-wins preserves active files with real MySQL locks",async()=>{const productId=await resetRaceFixture();const connection=await pool.getConnection();try{await activate(connection,productId);}finally{connection.release();}const result=await service.reconcile(-1_000);expect(result.deleted).toBe(0);const [rows]=await pool.execute<any[]>("SELECT m.state,p.primary_media_id=m.id linked FROM erp_product_media m JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.media_id=? AND m.client_id=?",[mediaId,a.tenantId]);expect(rows[0]).toMatchObject({state:"active",linked:1});await expect(Promise.all([writeFile(original(),"still-present",{flag:"r+"}),writeFile(thumbnail(),"still-present",{flag:"r+"})])).resolves.toBeTruthy();});
  it("proves reconciler-wins blocks and rejects concurrent activation",async()=>{const productId=await resetRaceFixture("pending_delete");let reached!:()=>void;const atFilesystem=new Promise<void>(resolve=>{reached=resolve;});let proceed!:()=>void;const barrier=new Promise<void>(resolve=>{proceed=resolve;});const lockedService=new ProductMediaService(pool,root,async file=>{reached();await barrier;await rm(file,{force:true});});const reconciliation=lockedService.reconcile(-1_000);await atFilesystem;const connection=await pool.getConnection();const activation=activate(connection,productId).finally(()=>connection.release());await observeLockWait();proceed();await expect(reconciliation).resolves.toMatchObject({deleted:1});await expect(activation).rejects.toThrow(/ACTIVATION_REJECTED_deleted/);const [rows]=await pool.execute<any[]>("SELECT m.state,p.primary_media_id FROM erp_product_media m JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE m.media_id=?",[mediaId]);expect(rows[0]).toMatchObject({state:"deleted",primary_media_id:null});});
  it("serializes two real reconcilers without double deletion",async()=>{await resetRaceFixture("pending_delete");let reached!:()=>void;const atFilesystem=new Promise<void>(resolve=>{reached=resolve;});let proceed!:()=>void;const barrier=new Promise<void>(resolve=>{proceed=resolve;});let removals=0;const first=new ProductMediaService(pool,root,async file=>{reached();await barrier;removals++;await rm(file,{force:true});});const one=first.reconcile(-1_000);await atFilesystem;const two=service.reconcile(-1_000);await observeLockWait();proceed();const results=await Promise.all([one,two]);expect(results.map(value=>value.deleted).sort()).toEqual([0,1]);expect(removals).toBe(2);const [rows]=await pool.execute<any[]>("SELECT state FROM erp_product_media WHERE media_id=?",[mediaId]);expect(rows[0].state).toBe("deleted");});
  it("rolls back a filesystem failure and converges on retry",async()=>{await resetRaceFixture("pending_delete");const failing=new ProductMediaService(pool,root,async()=>{throw new Error("SYNTHETIC_FILESYSTEM_FAILURE");});await expect(failing.reconcile(-1_000)).rejects.toThrow("SYNTHETIC_FILESYSTEM_FAILURE");const [before]=await pool.execute<any[]>("SELECT state FROM erp_product_media WHERE media_id=?",[mediaId]);expect(before[0].state).toBe("pending_delete");await expect(service.reconcile(-1_000)).resolves.toMatchObject({deleted:1});});
  it("converges after a crash-like rollback between the two file removals",async()=>{await resetRaceFixture("pending_delete");let calls=0;const interrupted=new ProductMediaService(pool,root,async file=>{calls++;await rm(file,{force:true});if(calls===2)throw new Error("SYNTHETIC_CONNECTION_LOSS");});await expect(interrupted.reconcile(-1_000)).rejects.toThrow("SYNTHETIC_CONNECTION_LOSS");const [before]=await pool.execute<any[]>("SELECT state FROM erp_product_media WHERE media_id=?",[mediaId]);expect(before[0].state).toBe("pending_delete");await expect(service.reconcile(-1_000)).resolves.toMatchObject({deleted:1});const [after]=await pool.execute<any[]>("SELECT state FROM erp_product_media WHERE media_id=?",[mediaId]);expect(after[0].state).toBe("deleted");});
});
