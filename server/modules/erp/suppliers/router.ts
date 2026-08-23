import { z } from "zod";
import { megadeskProcedure,router } from "../../../_core/trpc";
import { supplierInput,supplierListInput,supplierPublicId } from "./contracts";
import { SupplierService } from "./service";
import { TRPCError } from "@trpc/server";
import { ErpDomainError, erpTrpcCode } from "../errors";
const service=new SupplierService();
type Context={tenantId:string;operationalUserId:string;operationalUserRole:"admin"|"manager"|"agent"|"viewer"};
const identity=(ctx:Context)=>({clientId:ctx.tenantId,userId:ctx.operationalUserId,role:ctx.operationalUserRole});
async function run<T>(operation:()=>Promise<T>):Promise<T>{try{return await operation();}catch(error){if(error instanceof ErpDomainError)throw new TRPCError({code:erpTrpcCode(error),message:error.message});throw error;}}
export const suppliersRouter=router({list:megadeskProcedure.input(supplierListInput).query(({input,ctx})=>run(()=>service.list(identity(ctx),input))),detail:megadeskProcedure.input(z.object({publicId:supplierPublicId})).query(({input,ctx})=>run(()=>service.detail(identity(ctx),input.publicId))),create:megadeskProcedure.input(supplierInput).mutation(({input,ctx})=>run(()=>service.create(identity(ctx),input))),update:megadeskProcedure.input(supplierInput.and(z.object({publicId:supplierPublicId}))).mutation(({input,ctx})=>{const{publicId,...command}=input;return run(()=>service.update(identity(ctx),publicId,command));}),setActive:megadeskProcedure.input(z.object({publicId:supplierPublicId,active:z.boolean()})).mutation(({input,ctx})=>run(()=>service.setActive(identity(ctx),input.publicId,input.active)))});
