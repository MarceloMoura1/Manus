import type { Express, Request, Response } from "express";
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";

export const PRODUCT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_MEDIA_MAX_PIXELS = 40_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Identity = { tenantId: string; userId: string; role: string };
type MediaRow = RowDataPacket & { id:number; media_id:string; client_id:string; product_id:number; storage_key:string; thumbnail_storage_key:string; mime_type:string; byte_size:number; sha256:string; width:number; height:number; state:string };

export class ProductMediaError extends Error { constructor(public code: "BAD_IMAGE"|"TOO_LARGE"|"NOT_FOUND"|"FORBIDDEN"|"CONFLICT"|"STORAGE", message:string){super(message);} }

function validateProductId(productPublicId:string) {
  if (!UUID.test(productPublicId)) throw new ProductMediaError("BAD_IMAGE","Requisição de mídia inválida.");
}

function validateMediaRoot(root:string):string {
  if (!root || !path.isAbsolute(root)) throw new ProductMediaError("STORAGE", "Armazenamento de mídia não configurado.");
  const resolved=path.resolve(root);
  if(process.env.NODE_ENV==="test"){
    const runId=process.env.MEGADESK_MEDIA_TEST_RUN_ID?.trim();
    if(!runId||!resolved.toLowerCase().includes(runId.toLowerCase())) throw new ProductMediaError("STORAGE","Storage temporário não pertence à execução de teste.");
    let info;try{info=lstatSync(resolved);}catch{throw new ProductMediaError("STORAGE","Diretório temporário de mídia não existe.");}
    if(!info.isDirectory()||info.isSymbolicLink())throw new ProductMediaError("STORAGE","Diretório temporário de mídia inválido.");
  }
  return resolved;
}

export function productMediaRoot(): string {
  const configured = process.env.MEGADESK_MEDIA_ROOT?.trim();
  const local = process.env.LOCALAPPDATA?.trim();
  if (process.env.NODE_ENV === "test" && !configured) throw new ProductMediaError("STORAGE", "Storage temporário de mídia não provisionado para o teste.");
  const root = configured || (local ? path.join(local, "MegaDesk", "media") : "");
  return validateMediaRoot(root);
}

export function resolveMediaPath(root: string, key: string): string {
  if (!/^(objects|thumbnails)\/[0-9a-f]{2}\/[0-9a-f-]{36}\.webp$/i.test(key)) throw new ProductMediaError("STORAGE", "Referência de mídia inválida.");
  const resolved = path.resolve(root, ...key.split("/"));
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new ProductMediaError("STORAGE", "Referência de mídia inválida.");
  return resolved;
}

export async function processProductImage(bytes: Buffer) {
  if (!bytes.length) throw new ProductMediaError("BAD_IMAGE", "Selecione uma imagem válida.");
  if (bytes.length > PRODUCT_MEDIA_MAX_BYTES) throw new ProductMediaError("TOO_LARGE", "A imagem deve ter no máximo 5 MB.");
  try {
    const input = sharp(bytes, { animated: true, failOn: "error", limitInputPixels: PRODUCT_MEDIA_MAX_PIXELS });
    const meta = await input.metadata();
    if (!meta.width || !meta.height || !["jpeg","png","webp"].includes(meta.format ?? "")) throw new Error("unsupported");
    if ((meta.pages ?? 1) !== 1) throw new Error("animated");
    if (meta.width > 10_000 || meta.height > 10_000 || meta.width * meta.height > PRODUCT_MEDIA_MAX_PIXELS) throw new Error("dimensions");
    const main = await sharp(bytes, { failOn: "error", limitInputPixels: PRODUCT_MEDIA_MAX_PIXELS }).rotate().resize({ width:1600, height:1600, fit:"inside", withoutEnlargement:true }).webp({ quality:84 }).toBuffer({ resolveWithObject:true });
    const thumbnail = await sharp(bytes, { failOn: "error", limitInputPixels: PRODUCT_MEDIA_MAX_PIXELS }).rotate().resize({ width:320, height:320, fit:"cover" }).webp({ quality:76 }).toBuffer();
    return { main:main.data, thumbnail, width:main.info.width, height:main.info.height, mimeType:"image/webp" as const, sha256:createHash("sha256").update(main.data).digest("hex") };
  } catch (error) {
    if (error instanceof ProductMediaError) throw error;
    throw new ProductMediaError("BAD_IMAGE", "O arquivo não é uma imagem JPG, PNG ou WebP estática válida.");
  }
}

async function atomicWrite(target:string, data:Buffer) {
  await mkdir(path.dirname(target), { recursive:true });
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, target); } catch (error) { await rm(temp,{force:true}); throw error; }
}

export class ProductMediaService {
  constructor(private pool:Pool=getPool(), private root=productMediaRoot(), private removeFile:(file:string)=>Promise<void>=(file)=>rm(file,{force:true})) { this.root=validateMediaRoot(root); }
  private async product(connection:Pool|PoolConnection, clientId:string, publicId:string, lock=false) {
    const [rows]=await connection.execute<RowDataPacket[]>(`SELECT id,primary_media_id FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1${lock?" FOR UPDATE":""}`,[clientId,publicId]); return rows[0]??null;
  }
  async upload(identity:Identity, productPublicId:string, attemptId:string, bytes:Buffer) {
    validateProductId(productPublicId);
    if (!UUID.test(attemptId)) throw new ProductMediaError("BAD_IMAGE","Requisição de mídia inválida.");
    if (!['admin','manager'].includes(identity.role)) throw new ProductMediaError("FORBIDDEN","Seu perfil não permite alterar produtos.");
    const image=await processProductImage(bytes); const mediaId=randomUUID(); const shard=mediaId.slice(0,2); const storageKey=`objects/${shard}/${mediaId}.webp`; const thumbnailStorageKey=`thumbnails/${shard}/${mediaId}.webp`;
    const c=await this.pool.getConnection(); let media:MediaRow;
    try { await c.beginTransaction(); const product=await this.product(c,identity.tenantId,productPublicId,true); if(!product) throw new ProductMediaError("NOT_FOUND","Produto não encontrado.");
      const [existing]=await c.execute<MediaRow[]>("SELECT * FROM erp_product_media WHERE client_id=? AND client_attempt_id=? LIMIT 1 FOR UPDATE",[identity.tenantId,attemptId]);
      if(existing[0]) { if(existing[0].product_id!==product.id||existing[0].sha256!==image.sha256) throw new ProductMediaError("CONFLICT","Esta tentativa já foi usada com outro arquivo."); media=existing[0]; }
      else { await c.execute("INSERT INTO erp_product_media(media_id,client_id,product_id,storage_key,thumbnail_storage_key,mime_type,byte_size,sha256,width,height,state,client_attempt_id,created_by) VALUES(?,?,?,?,?,'image/webp',?,?,?,?, 'staged',?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[mediaId,identity.tenantId,product.id,storageKey,thumbnailStorageKey,image.main.length,image.sha256,image.width,image.height,attemptId,identity.userId]); const [created]=await c.execute<MediaRow[]>("SELECT * FROM erp_product_media WHERE client_id=? AND client_attempt_id=? FOR UPDATE",[identity.tenantId,attemptId]); media=created[0]; if(media.product_id!==product.id||media.sha256!==image.sha256) throw new ProductMediaError("CONFLICT","Esta tentativa já foi usada com outro arquivo."); }
      await c.commit();
    } catch(error){await c.rollback();throw error;} finally{c.release();}
    if(media.state==="active") return {mediaId:media.media_id};
    const a=await this.pool.getConnection();
    try { await a.beginTransaction(); const product=await this.product(a,identity.tenantId,productPublicId,true); if(!product) throw new ProductMediaError("NOT_FOUND","Produto não encontrado."); const [current]=await a.execute<MediaRow[]>("SELECT * FROM erp_product_media WHERE id=? AND client_id=? FOR UPDATE",[media.id,identity.tenantId]); if(!current[0]) throw new ProductMediaError("NOT_FOUND","Mídia não encontrada.");
      if(current[0].state==="active"){await a.commit();return{mediaId:current[0].media_id};}
      if(current[0].state!=="staged")throw new ProductMediaError("CONFLICT","A mídia não pode mais ser ativada.");
      try { await atomicWrite(resolveMediaPath(this.root,current[0].storage_key),image.main); await atomicWrite(resolveMediaPath(this.root,current[0].thumbnail_storage_key),image.thumbnail); }
      catch { throw new ProductMediaError("STORAGE","Não foi possível armazenar a imagem com segurança."); }
      if(product.primary_media_id&&product.primary_media_id!==media.id) await a.execute("UPDATE erp_product_media SET state='pending_delete',pending_delete_at=NOW() WHERE id=? AND client_id=? AND state='active'",[product.primary_media_id,identity.tenantId]);
      await a.execute("UPDATE erp_products SET primary_media_id=? WHERE id=? AND client_id=?",[media.id,product.id,identity.tenantId]); const [activated]=await a.execute<any>("UPDATE erp_product_media SET state='active',activated_at=COALESCE(activated_at,NOW()),pending_delete_at=NULL WHERE id=? AND client_id=? AND state='staged'",[media.id,identity.tenantId]); if(activated.affectedRows!==1)throw new ProductMediaError("CONFLICT","A mídia não pode mais ser ativada."); await a.commit(); return {mediaId:media.media_id};
    } catch(error){await a.rollback();throw error;} finally{a.release();}
  }
  async remove(identity:Identity, productPublicId:string) { validateProductId(productPublicId); if(!['admin','manager'].includes(identity.role)) throw new ProductMediaError("FORBIDDEN","Seu perfil não permite alterar produtos."); const c=await this.pool.getConnection(); try{await c.beginTransaction();const product=await this.product(c,identity.tenantId,productPublicId,true);if(!product)throw new ProductMediaError("NOT_FOUND","Produto não encontrado.");if(product.primary_media_id){await c.execute("UPDATE erp_products SET primary_media_id=NULL WHERE id=? AND client_id=?",[product.id,identity.tenantId]);await c.execute("UPDATE erp_product_media SET state='pending_delete',pending_delete_at=NOW() WHERE id=? AND client_id=? AND state='active'",[product.primary_media_id,identity.tenantId]);}await c.commit();return{ok:true};}catch(e){await c.rollback();throw e;}finally{c.release();} }
  async read(clientId:string, productPublicId:string, thumbnail:boolean){validateProductId(productPublicId);for(let attempt=0;attempt<3;attempt++){const [rows]=await this.pool.execute<MediaRow[]>(`SELECT m.* FROM erp_products p INNER JOIN erp_product_media m ON m.id=p.primary_media_id AND m.client_id=p.client_id AND m.product_id=p.id AND m.state='active' WHERE p.client_id=? AND p.public_id=? LIMIT 1`,[clientId,productPublicId]);if(rows[0]){const key=thumbnail?rows[0].thumbnail_storage_key:rows[0].storage_key;return{path:resolveMediaPath(this.root,key),mimeType:rows[0].mime_type};}if(attempt<2)await new Promise(resolve=>setTimeout(resolve,10));}throw new ProductMediaError("NOT_FOUND","Imagem não encontrada.");}
  async reconcile(graceMs=24*60*60*1000,limit=100){const boundedGraceMicros=Math.trunc(Math.max(-60_000,Math.min(30*24*60*60*1000,Number.isFinite(graceMs)?graceMs:24*60*60*1000))*1_000);const boundedLimit=Math.max(1,Math.min(500,Math.trunc(limit)));const [candidates]=await this.pool.execute<MediaRow[]>(`SELECT m.* FROM erp_product_media m LEFT JOIN erp_products p ON p.primary_media_id=m.id AND p.client_id=m.client_id WHERE m.state IN ('staged','pending_delete') AND COALESCE(m.pending_delete_at,m.created_at)<DATE_SUB(NOW(6),INTERVAL ${boundedGraceMicros} MICROSECOND) AND p.id IS NULL ORDER BY m.id LIMIT ${boundedLimit}`);let deleted=0;for(const candidate of candidates){const c=await this.pool.getConnection();try{await c.beginTransaction();const [products]=await c.execute<RowDataPacket[]>("SELECT id,primary_media_id FROM erp_products WHERE id=? AND client_id=? FOR UPDATE",[candidate.product_id,candidate.client_id]);if(!products[0]||products[0].primary_media_id===candidate.id){await c.rollback();continue;}const [rows]=await c.execute<MediaRow[]>(`SELECT * FROM erp_product_media WHERE id=? AND client_id=? AND state IN ('staged','pending_delete') AND COALESCE(pending_delete_at,created_at)<DATE_SUB(NOW(6),INTERVAL ${boundedGraceMicros} MICROSECOND) FOR UPDATE`,[candidate.id,candidate.client_id]);const row=rows[0];if(!row){await c.rollback();continue;}for(const key of [row.storage_key,row.thumbnail_storage_key])await this.removeFile(resolveMediaPath(this.root,key));const [result]=await c.execute<any>("UPDATE erp_product_media SET state='deleted',deleted_at=NOW() WHERE id=? AND client_id=? AND state IN ('staged','pending_delete')",[row.id,row.client_id]);if(result.affectedRows!==1)throw new ProductMediaError("CONFLICT","A mídia não pôde ser reconciliada.");await c.commit();deleted++;}catch(error){await c.rollback();throw error;}finally{c.release();}}return{examined:candidates.length,deleted};}
}

function status(error:unknown){return error instanceof ProductMediaError?error.code==="FORBIDDEN"?403:error.code==="NOT_FOUND"?404:error.code==="TOO_LARGE"?413:error.code==="CONFLICT"?409:400:500;}
type ProductMediaRouteService=Pick<ProductMediaService,"upload"|"remove"|"read">;
export type ProductMediaRouteDependencies={resolveIdentity:(req:Request)=>Promise<Identity|null>;createService:()=>ProductMediaRouteService};
const defaultRouteDependencies:ProductMediaRouteDependencies={resolveIdentity:identity,createService:()=>new ProductMediaService()};
export function registerProductMediaRoutes(app:Express,deps:ProductMediaRouteDependencies=defaultRouteDependencies){
  const raw=express.raw({type:["image/jpeg","image/png","image/webp","application/octet-stream"],limit:PRODUCT_MEDIA_MAX_BYTES});
  app.put("/api/products/:productId/image",raw,(req,res)=>void handleUpload(req,res,deps)); app.delete("/api/products/:productId/image",(req,res)=>void handleRemove(req,res,deps)); app.get("/api/products/:productId/image",(req,res)=>void handleRead(req,res,deps));
}
async function identity(req:Request):Promise<Identity|null>{const x=await resolveOperationalSessionReadOnly(req);return x?{tenantId:x.tenantId,userId:x.userId,role:x.role}:null;}
async function handleUpload(req:Request,res:Response,deps:ProductMediaRouteDependencies){try{const i=await deps.resolveIdentity(req);if(!i){res.status(401).end();return;}validateProductId(req.params.productId);const attempt=String(req.header("x-client-attempt-id")??"");const result=await deps.createService().upload(i,req.params.productId,attempt,Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0));res.status(200).json(result);}catch(e){res.status(status(e)).json({error:e instanceof ProductMediaError?e.message:"Não foi possível salvar a imagem."});}}
async function handleRemove(req:Request,res:Response,deps:ProductMediaRouteDependencies){try{const i=await deps.resolveIdentity(req);if(!i){res.status(401).end();return;}validateProductId(req.params.productId);res.json(await deps.createService().remove(i,req.params.productId));}catch(e){res.status(status(e)).json({error:e instanceof ProductMediaError?e.message:"Não foi possível remover a imagem."});}}
async function handleRead(req:Request,res:Response,deps:ProductMediaRouteDependencies){try{const i=await deps.resolveIdentity(req);if(!i){res.status(401).end();return;}validateProductId(req.params.productId);const media=await deps.createService().read(i.tenantId,req.params.productId,req.query.variant==="thumbnail");const info=await stat(media.path);res.setHeader("Content-Type",media.mimeType);res.setHeader("Content-Length",String(info.size));res.setHeader("Content-Disposition","inline");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Cache-Control","private, max-age=300");res.sendFile(media.path);}catch(e){res.status(status(e)).json({error:"Imagem não encontrada."});}}
