import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure,router } from "../../../_core/trpc";
import { ErpDomainError,erpTrpcCode } from "../errors";
import { accountInput,cancelEntryInput,categoryInput,financeListInput,manualEntryInput,periodInput,settlementInput,sourceEntryInput,updateEntryInput } from "./contracts";
import { FinanceService } from "./service";
const service=new FinanceService();
type Context={tenantId:string;operationalUserId:string;operationalUserRole:"admin"|"manager"|"agent"|"viewer";operationalPermissions?:string[];operationalSessionId?:string};
const identity=(ctx:Context)=>({clientId:ctx.tenantId,userId:ctx.operationalUserId,role:ctx.operationalUserRole});
async function run<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){if(e instanceof ErpDomainError)throw new TRPCError({code:erpTrpcCode(e),message:e.message});throw e;}}
const id=z.object({publicId:z.string().uuid()});
const financeProcedure=megadeskProcedure.use(({ctx,next})=>{
  const trustedTestContext=process.env.NODE_ENV==="test"&&!ctx.operationalSessionId;
  if(!trustedTestContext&&!ctx.operationalPermissions?.includes("erp")){
    throw new TRPCError({code:"FORBIDDEN",message:"Acesso ao módulo ERP indisponível."});
  }
  return next({ctx});
});
export const financeRouter=router({
  options:financeProcedure.query(({ctx})=>run(()=>service.options(identity(ctx)))), summary:financeProcedure.input(periodInput).query(({ctx,input})=>run(()=>service.summary(identity(ctx),input))),
  list:financeProcedure.input(financeListInput).query(({ctx,input})=>run(()=>service.list(identity(ctx),input))), detail:financeProcedure.input(id).query(({ctx,input})=>run(()=>service.detail(identity(ctx),input.publicId))),
  accounts:router({create:financeProcedure.input(accountInput).mutation(({ctx,input})=>run(()=>service.createAccount(identity(ctx),input))),setActive:financeProcedure.input(id.extend({active:z.boolean()})).mutation(({ctx,input})=>run(()=>service.setAccountActive(identity(ctx),input.publicId,input.active))),ledger:financeProcedure.input(id).query(({ctx,input})=>run(()=>service.ledger(identity(ctx),input.publicId)))}),
  categories:router({create:financeProcedure.input(categoryInput).mutation(({ctx,input})=>run(()=>service.createCategory(identity(ctx),input))),setActive:financeProcedure.input(id.extend({active:z.boolean()})).mutation(({ctx,input})=>run(()=>service.setCategoryActive(identity(ctx),input.publicId,input.active)))}),
  createManual:financeProcedure.input(manualEntryInput).mutation(({ctx,input})=>run(()=>service.createManual(identity(ctx),input))),
  fromPurchase:financeProcedure.input(sourceEntryInput).mutation(({ctx,input})=>run(()=>service.createFromSource(identity(ctx),"purchase_order",input))),
  fromSale:financeProcedure.input(sourceEntryInput).mutation(({ctx,input})=>run(()=>service.createFromSource(identity(ctx),"sales_order",input))),
  update:financeProcedure.input(updateEntryInput).mutation(({ctx,input})=>run(()=>service.update(identity(ctx),input))),
  settle:financeProcedure.input(settlementInput).mutation(({ctx,input})=>run(()=>service.settlePartial(identity(ctx),input.publicId,input.financialAccountPublicId,input.idempotencyKey,input.amountCents))),
  cancel:financeProcedure.input(cancelEntryInput).mutation(({ctx,input})=>run(()=>service.cancel(identity(ctx),input.publicId,input.reason))),
});
