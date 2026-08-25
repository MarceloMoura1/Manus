import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEventForRoles } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import { canReadFinance, canWriteFinance, financeEvent, type AccountInput, type CategoryInput, type FinanceListInput, type FinanceOperation, type ManualEntryInput, type SourceEntryInput, type UpdateEntryInput } from "./contracts";
import { FinanceRepository } from "./repository";
type Identity={clientId:string;userId:string;role:OperationalRole};
export type FinanceEventPublisher={publish(clientId:string,event:"erp:finance.entry.changed"|"erp:finance.account.changed",payload:Record<string,string>):void|Promise<void>};
const publisher:FinanceEventPublisher={publish:(clientId,event,payload)=>emitOperationalTenantEventForRoles(clientId,event,payload,["admin","manager","viewer"])};
export class FinanceService {
  constructor(private repository=new FinanceRepository(),private events:FinanceEventPublisher=publisher){}
  private read(i:Identity){if(!canReadFinance(i.role))throw new ErpDomainError("FORBIDDEN","Seu perfil não permite acessar o Financeiro.");}
  private write(i:Identity){this.read(i);if(!canWriteFinance(i.role))throw new ErpDomainError("FORBIDDEN","Seu perfil possui acesso somente leitura ao Financeiro.");}
  private publish(clientId:string,event:"erp:finance.entry.changed"|"erp:finance.account.changed",publicId:string,operation:FinanceOperation){return runPostCommitBestEffort([()=>this.events.publish(clientId,event,financeEvent(publicId,operation))]);}
  async options(i:Identity){this.read(i);return {...await this.repository.options(i.clientId),canWrite:canWriteFinance(i.role)};}
  async summary(i:Identity,period:{from?:string;to?:string}){this.read(i);return this.repository.summary(i.clientId,period.from,period.to);}
  async list(i:Identity,input:FinanceListInput){this.read(i);const r=await this.repository.list(i.clientId,input);return {...r,page:input.page,pageSize:input.pageSize,totalPages:Math.ceil(r.total/input.pageSize),canWrite:canWriteFinance(i.role)};}
  async detail(i:Identity,id:string){this.read(i);const r=await this.repository.detail(i.clientId,id);if(!r)throw new ErpDomainError("NOT_FOUND","Título não encontrado.");return {...r,canWrite:canWriteFinance(i.role)};}
  async createAccount(i:Identity,input:AccountInput){this.write(i);const r=await this.repository.createAccount(i.clientId,i.userId,input);await this.publish(i.clientId,"erp:finance.account.changed",r.publicId,"created");return r;}
  async setAccountActive(i:Identity,id:string,active:boolean){this.write(i);const r=await this.repository.setAccountActive(i.clientId,id,active);await this.publish(i.clientId,"erp:finance.account.changed",id,active?"activated":"deactivated");return r;}
  async createCategory(i:Identity,input:CategoryInput){this.write(i);const r=await this.repository.createCategory(i.clientId,input);return r;}
  async setCategoryActive(i:Identity,id:string,active:boolean){this.write(i);return this.repository.setCategoryActive(i.clientId,id,active);}
  async createManual(i:Identity,input:ManualEntryInput){this.write(i);const r=await this.repository.createManual(i.clientId,i.userId,input);if(!r)throw new Error("Título não persistido.");await this.publish(i.clientId,"erp:finance.entry.changed",r.publicId,"created");return r;}
  async createFromSource(i:Identity,kind:"purchase_order"|"sales_order",input:SourceEntryInput){this.write(i);const r=await this.repository.createFromSource(i.clientId,i.userId,kind,input);if(!r.entry)throw new Error("Título não persistido.");if(!r.replay)await this.publish(i.clientId,"erp:finance.entry.changed",r.entry.publicId,"created");return {...r.entry,replay:r.replay};}
  async update(i:Identity,input:UpdateEntryInput){this.write(i);const r=await this.repository.update(i.clientId,input.publicId,input);if(!r)throw new Error("Título não persistido.");await this.publish(i.clientId,"erp:finance.entry.changed",input.publicId,"updated");return r;}
  async settle(i:Identity,id:string,accountId:string,key:string){this.write(i);const r=await this.repository.settle(i.clientId,i.userId,id,accountId,key);if(!r.entry)throw new Error("Liquidação não persistida.");if(!r.replay){await runPostCommitBestEffort([()=>this.events.publish(i.clientId,"erp:finance.entry.changed",financeEvent(id,"settled")),()=>this.events.publish(i.clientId,"erp:finance.account.changed",financeEvent(accountId,"updated"))]);}return {...r.entry,replay:r.replay};}
  async cancel(i:Identity,id:string,reason:string){this.write(i);const r=await this.repository.cancel(i.clientId,i.userId,id,reason);if(!r)throw new Error("Cancelamento não persistido.");await this.publish(i.clientId,"erp:finance.entry.changed",id,"cancelled");return r;}
  async ledger(i:Identity,id:string){this.read(i);return this.repository.ledger(i.clientId,id);}
}
