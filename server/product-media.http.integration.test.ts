import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import sharp from "sharp";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { ProductMediaError, processProductImage, registerProductMediaRoutes } from "./product-media";

const port=4176;
const base=`http://127.0.0.1:${port}`;
const product="11111111-1111-4111-8111-111111111111";
const runId=process.env.MEGADESK_MEDIA_TEST_RUN_ID?.trim();
const root=process.env.MEGADESK_MEDIA_ROOT?.trim();

describe.runIf(Boolean(runId&&root))("isolated product media HTTP contract",()=>{
  let server:Server;
  let image:Buffer;
  let imagePath:string;
  const attempts=new Map<string,string>();
  let currentMedia="media-initial";
  let removed=false;

  beforeAll(async()=>{
    if(!runId||!root||!path.isAbsolute(root)||!path.resolve(root).toLowerCase().includes(runId.toLowerCase()))throw new Error("explicit test media root required");
    await mkdir(root,{recursive:false});
    const info=await lstat(root);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error("invalid test media root");
    image=await sharp({create:{width:16,height:12,channels:3,background:"#2463eb"}}).webp().toBuffer();
    imagePath=path.join(root,"synthetic.webp");
    await writeFile(imagePath,image,{flag:"wx"});
    const app=express();
    registerProductMediaRoutes(app,{
      resolveIdentity:async req=>req.header("x-test-session")==="tenant-a"?{tenantId:"tenant-a",userId:"synthetic-user",role:"admin"}:null,
      createService:()=>({
        async read(tenantId,publicId){if(tenantId!=="tenant-a"||publicId!==product||removed)throw new ProductMediaError("NOT_FOUND","Imagem não encontrada.");return{path:imagePath,mimeType:"image/webp"};},
        async upload(identity,publicId,attemptId,bytes){if(identity.tenantId!=="tenant-a"||publicId!==product)throw new ProductMediaError("NOT_FOUND","Produto não encontrado.");await processProductImage(bytes);const prior=attempts.get(attemptId);if(prior)return{mediaId:prior};currentMedia=`media-${attempts.size+1}`;attempts.set(attemptId,currentMedia);removed=false;return{mediaId:currentMedia};},
        async remove(identity,publicId){if(identity.tenantId!=="tenant-a"||publicId!==product)throw new ProductMediaError("NOT_FOUND","Produto não encontrado.");removed=true;return{ok:true};},
      }),
    });
    await new Promise<void>((resolve,reject)=>{server=app.listen(port,"127.0.0.1",resolve);server.once("error",reject);});
  });

  afterAll(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(root)await rm(root,{recursive:true,force:true});
  });

  const request=(suffix:string,init:RequestInit={})=>fetch(`${base}${suffix}`,{redirect:"manual",...init,headers:{"x-test-session":"tenant-a",...init.headers}});

  it("rejects missing or incomplete synthetic sessions",async()=>{
    expect((await fetch(`${base}/api/products/${product}/image`)).status).toBe(401);
    expect((await fetch(`${base}/api/products/${product}/image`,{headers:{"x-test-session":"no-tenant"}})).status).toBe(401);
  });

  it("returns sanitized tenant, product and media misses",async()=>{
    const response=await request("/api/products/22222222-2222-4222-8222-222222222222/image");expect(response.status).toBe(404);const body=await response.text();expect(body).toContain("Imagem não encontrada");expect(body).not.toMatch(/storage|objects|thumbnails|[A-Z]:\\/i);
  });

  it("rejects invalid product UUIDs consistently on upload, read and remove",async()=>{
    const jpeg=await sharp({create:{width:4,height:4,channels:3,background:"red"}}).jpeg().toBuffer();
    const responses=await Promise.all([
      request("/api/products/invalid/image",{method:"PUT",headers:{"content-type":"image/jpeg","x-client-attempt-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},body:jpeg}),
      request("/api/products/invalid/image"),
      request("/api/products/invalid/image",{method:"DELETE"}),
    ]);
    expect(responses.map(response=>response.status)).toEqual([400,400,400]);
    for(const response of responses)expect(await response.text()).not.toMatch(/stack|storage|objects|thumbnails|[A-Z]:\\/i);
  });

  it("serves normalized private bytes without redirect or physical paths",async()=>{
    const response=await request(`/api/products/${product}/image?variant=thumbnail`);
    expect(response.status).toBe(200);expect(response.url).toBe(`${base}/api/products/${product}/image?variant=thumbnail`);
    expect(response.headers.get("content-type")).toMatch(/^image\/webp/);expect(response.headers.get("content-length")).toBe(String(image.length));
    expect(response.headers.get("content-disposition")).toBe("inline");expect(response.headers.get("x-content-type-options")).toBe("nosniff");expect(response.headers.get("cache-control")).toMatch(/^private/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
  });

  it("uploads, replaces, retries idempotently and removes",async()=>{
    const jpeg=await sharp({create:{width:20,height:18,channels:3,background:"#ef4444"}}).jpeg().toBuffer();
    const put=(attempt:string,body:Buffer)=>request(`/api/products/${product}/image`,{method:"PUT",headers:{"content-type":"image/jpeg","x-client-attempt-id":attempt},body});
    const first=await put("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",jpeg);expect(first.status).toBe(200);const firstBody=await first.json();
    const retry=await put("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",jpeg);expect(await retry.json()).toEqual(firstBody);
    const replacement=await put("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",jpeg);expect((await replacement.json()).mediaId).not.toBe(firstBody.mediaId);
    const deletion=await request(`/api/products/${product}/image`,{method:"DELETE"});expect(deletion.status).toBe(200);
    expect((await request(`/api/products/${product}/image`)).status).toBe(404);
  });

  it("sanitizes sharp failures and never returns public URLs or base64",async()=>{
    const response=await request(`/api/products/${product}/image`,{method:"PUT",headers:{"content-type":"image/png","x-client-attempt-id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},body:Buffer.from("not-an-image")});
    expect(response.status).toBe(400);const body=await response.text();expect(body).not.toMatch(/stack|sharp|https?:\/\/|data:image|base64|LOCALAPPDATA|storage_key/i);
  });
});
