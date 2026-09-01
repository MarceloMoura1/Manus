import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { PRODUCT_MEDIA_MAX_BYTES, ProductMediaError, processProductImage, productMediaRoot, resolveMediaPath } from "./product-media";
import { ProductMediaService } from "./product-media";

async function fixture(format: "jpeg"|"png"|"webp", width=40, height=30) {
  return sharp({ create:{ width,height,channels:3,background:{r:20,g:100,b:180} } })[format]().toBuffer();
}

describe("private product media processing", () => {
  it.each(["jpeg","png","webp"] as const)("accepts and normalizes static %s", async format => {
    const result=await processProductImage(await fixture(format));
    expect(result.mimeType).toBe("image/webp"); expect(result.width).toBe(40); expect(result.height).toBe(30);
    expect((await sharp(result.thumbnail).metadata()).format).toBe("webp");
  });
  it("rejects false MIME bytes, SVG and animated images", async () => {
    await expect(processProductImage(Buffer.from("not an image"))).rejects.toBeInstanceOf(ProductMediaError);
    await expect(processProductImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toBeInstanceOf(ProductMediaError);
    const pixels=Buffer.alloc(2*4*4,255); const animated=await sharp(pixels,{raw:{width:2,height:4,channels:4},animated:true,pageHeight:2}).gif({pageHeight:2,loop:0}).toBuffer();
    await expect(processProductImage(animated)).rejects.toBeInstanceOf(ProductMediaError);
  });
  it("rejects oversized bytes and pixel bombs", async () => {
    await expect(processProductImage(Buffer.alloc(PRODUCT_MEDIA_MAX_BYTES+1))).rejects.toMatchObject({code:"TOO_LARGE"});
    const header=await fixture("png",100,100); await expect(processProductImage(header)).resolves.toBeTruthy();
  });
  it("removes metadata, creates a bounded thumbnail and normalizes orientation", async () => {
    const source=await sharp(await fixture("jpeg",60,30)).withMetadata({orientation:6,comment:"private"}).jpeg().toBuffer();
    const result=await processProductImage(source); const meta=await sharp(result.main).metadata(); const thumb=await sharp(result.thumbnail).metadata();
    expect(meta.orientation).toBeUndefined(); expect(meta.comments).toBeUndefined(); expect([result.width,result.height]).toEqual([30,60]); expect([thumb.width,thumb.height]).toEqual([320,320]);
  });
  it("accepts only opaque registered keys inside the configured root", () => {
    const root="C:\\safe-media"; const id="123e4567-e89b-42d3-a456-426614174000";
    expect(resolveMediaPath(root,`objects/12/${id}.webp`)).toContain(id);
    expect(()=>resolveMediaPath(root,"../../Windows/system.ini")).toThrow(ProductMediaError);
  });
  it("fails closed without an explicitly provisioned test directory", () => {
    const previousRoot=process.env.MEGADESK_MEDIA_ROOT; const previousRun=process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    const invalidRoot=`C:\\missing-media-test-run-${process.pid}`;
    delete process.env.MEGADESK_MEDIA_ROOT; delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    expect(()=>productMediaRoot()).toThrow(ProductMediaError);
    expect(existsSync(invalidRoot)).toBe(false);
    process.env.MEGADESK_MEDIA_ROOT=invalidRoot;process.env.MEGADESK_MEDIA_TEST_RUN_ID="test-run";
    expect(()=>productMediaRoot()).toThrow(ProductMediaError);
    expect(existsSync(invalidRoot)).toBe(false);
    if(previousRoot===undefined)delete process.env.MEGADESK_MEDIA_ROOT;else process.env.MEGADESK_MEDIA_ROOT=previousRoot;
    if(previousRun===undefined)delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;else process.env.MEGADESK_MEDIA_TEST_RUN_ID=previousRun;
  });

  it("validates product UUID consistently before upload, read and remove access storage or SQL", async () => {
    const service=Object.create(ProductMediaService.prototype) as ProductMediaService;
    const identity={tenantId:"tenant-a",userId:"user-a",role:"admin"};
    await expect(service.upload(identity,"invalid","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",Buffer.from("x"))).rejects.toMatchObject({code:"BAD_IMAGE"});
    await expect(service.read("tenant-a","invalid",false)).rejects.toMatchObject({code:"BAD_IMAGE"});
    await expect(service.remove(identity,"invalid")).rejects.toMatchObject({code:"BAD_IMAGE"});
  });
});

type ReconcileState={state:"pending_delete"|"active"|"deleted";primaryMediaId:number|null;files:Set<string>};

function controlledReconcile(state:ReconcileState, removeFile?:(file:string)=>Promise<void>){
  let locked=false;
  const waiters:Array<()=>void>=[];
  const acquire=async()=>{if(locked)await new Promise<void>(resolve=>waiters.push(resolve));locked=true;};
  const release=()=>{locked=false;waiters.shift()?.();};
  const candidate={id:7,media_id:"77777777-7777-4777-8777-777777777777",client_id:"tenant-a",product_id:3,storage_key:"objects/77/77777777-7777-4777-8777-777777777777.webp",thumbnail_storage_key:"thumbnails/77/77777777-7777-4777-8777-777777777777.webp",mime_type:"image/webp",byte_size:1,sha256:"a".repeat(64),width:1,height:1};
  const pool:any={
    async execute(sql:string){return sql.startsWith("SELECT m.*")&&state.state==="pending_delete"?[[{...candidate,state:state.state}],[]]:[[],[]];},
    async getConnection(){let owns=false;return{
      async beginTransaction(){},
      async execute(sql:string){
        if(sql.startsWith("SELECT id,primary_media_id")){await acquire();owns=true;return[[{id:3,primary_media_id:state.primaryMediaId}],[]];}
        if(sql.startsWith("SELECT * FROM erp_product_media"))return state.state==="pending_delete"?[[{...candidate,state:state.state}],[]]:[[],[]];
        if(sql.startsWith("UPDATE erp_product_media SET state='deleted'")){if(state.state!=="pending_delete")return[{affectedRows:0},[]];state.state="deleted";return[{affectedRows:1},[]];}
        throw new Error(`unexpected SQL: ${sql}`);
      },
      async commit(){if(owns){owns=false;release();}},
      async rollback(){if(owns){owns=false;release();}},
      release(){},
    };},
  };
  const remove=removeFile??(async(file:string)=>{state.files.delete(file);});
  const service=Object.create(ProductMediaService.prototype) as ProductMediaService;
  Object.assign(service,{pool,root:"C:\\media",removeFile:remove});
  const reactivate=async()=>{await acquire();try{if(state.state!=="pending_delete")throw new ProductMediaError("CONFLICT","claim won");state.state="active";state.primaryMediaId=7;}finally{release();}};
  return{service,reactivate};
}

describe("product media reconciliation ownership",()=>{
  const original="C:\\media\\objects\\77\\77777777-7777-4777-8777-777777777777.webp";
  const thumbnail="C:\\media\\thumbnails\\77\\77777777-7777-4777-8777-777777777777.webp";

  it("serializes two reconcilers so only one deletes the claimed media",async()=>{
    const state:ReconcileState={state:"pending_delete",primaryMediaId:null,files:new Set([original,thumbnail])};
    const {service}=controlledReconcile(state);
    const results=await Promise.all([service.reconcile(-1_000),service.reconcile(-1_000)]);
    expect(results.map(result=>result.deleted).sort()).toEqual([0,1]);
    expect(state.state).toBe("deleted");expect(state.files.size).toBe(0);
  });

  it("makes a deletion claim exclude deterministic concurrent reactivation",async()=>{
    const state:ReconcileState={state:"pending_delete",primaryMediaId:null,files:new Set([original,thumbnail])};
    let reached!:()=>void;const atFilesystem=new Promise<void>(resolve=>{reached=resolve;});
    let proceed!:()=>void;const barrier=new Promise<void>(resolve=>{proceed=resolve;});
    const {service,reactivate}=controlledReconcile(state,async file=>{reached();await barrier;state.files.delete(file);});
    const reconciliation=service.reconcile(-1_000);
    await atFilesystem;
    const activation=reactivate();
    proceed();
    await expect(activation).rejects.toMatchObject({code:"CONFLICT"});
    await expect(reconciliation).resolves.toMatchObject({deleted:1});
    expect(state).toMatchObject({state:"deleted",primaryMediaId:null});expect(state.files.size).toBe(0);
  });

  it("rolls back the database state after filesystem failure and converges on retry",async()=>{
    const state:ReconcileState={state:"pending_delete",primaryMediaId:null,files:new Set([original,thumbnail])};
    let fail=true;
    const {service}=controlledReconcile(state,async file=>{if(fail){fail=false;throw new Error("synthetic filesystem failure");}state.files.delete(file);});
    await expect(service.reconcile(-1_000)).rejects.toThrow("synthetic filesystem failure");
    expect(state.state).toBe("pending_delete");
    await expect(service.reconcile(-1_000)).resolves.toMatchObject({deleted:1});
    expect(state.state).toBe("deleted");expect(state.files.size).toBe(0);
  });
});
