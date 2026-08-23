import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import { canWriteSuppliers,normalizeSupplierInput,supplierEvent,type SupplierEvent,type SupplierInput,type SupplierListInput,type SupplierOperation } from "./contracts";
import { SupplierRepository,type SupplierRow } from "./repository";
type Identity={clientId:string;userId:string;role:OperationalRole};
export type SupplierEventPublisher={publish(clientId:string,event:"erp:supplier.changed",payload:SupplierEvent):void|Promise<void>};
const publisher:SupplierEventPublisher={publish:(clientId,event,payload)=>emitOperationalTenantEvent(clientId,event,payload)};
export function supplierPublic(row:SupplierRow){return{publicId:row.public_id,legalName:row.legal_name,tradeName:row.trade_name,personType:row.person_type,taxId:row.tax_id,stateRegistration:row.state_registration,email:row.email,phone:row.phone,contactName:row.contact_name,postalCode:row.postal_code,street:row.street,addressNumber:row.address_number,addressComplement:row.address_complement,district:row.district,city:row.city,state:row.state,notes:row.notes,active:row.active===1,createdAt:row.created_at,updatedAt:row.updated_at};}
function databaseCode(error:unknown):string|undefined{return typeof error==="object"&&error!==null&&"code" in error&&typeof error.code==="string"?error.code:undefined;}
export class SupplierService {
  constructor(private readonly repository=new SupplierRepository(),private readonly events:SupplierEventPublisher=publisher){}
  private assertWrite(identity:Identity){if(!canWriteSuppliers(identity.role))throw new ErpDomainError("FORBIDDEN","Seu perfil não permite alterar fornecedores.");}
  private async publish(clientId:string,publicId:string,operation:SupplierOperation){await runPostCommitBestEffort([()=>this.events.publish(clientId,"erp:supplier.changed",supplierEvent(publicId,operation))]);}
  private duplicate():never{throw new ErpDomainError("CONFLICT","CPF/CNPJ já cadastrado para outro fornecedor deste tenant.");}
  async list(identity:Identity,input:SupplierListInput){const result=await this.repository.list(identity.clientId,input);return{...result,items:result.items.map(supplierPublic),page:input.page,pageSize:input.pageSize,totalPages:Math.ceil(result.total/input.pageSize),canWrite:canWriteSuppliers(identity.role)};}
  async detail(identity:Identity,publicId:string){const row=await this.repository.find(identity.clientId,publicId);if(!row)throw new ErpDomainError("NOT_FOUND","Fornecedor não encontrado.");return supplierPublic(row);}
  async create(identity:Identity,input:SupplierInput){this.assertWrite(identity);const normalized=normalizeSupplierInput(input);if(normalized.taxId&&await this.repository.findByTaxId(identity.clientId,normalized.taxId))this.duplicate();try{const item=supplierPublic(await this.repository.create(identity.clientId,identity.userId,randomUUID(),normalized));await this.publish(identity.clientId,item.publicId,"created");return item;}catch(error){if(databaseCode(error)==="ER_DUP_ENTRY")this.duplicate();throw error;}}
  async update(identity:Identity,publicId:string,input:SupplierInput){this.assertWrite(identity);const normalized=normalizeSupplierInput(input);if(normalized.taxId&&await this.repository.findByTaxId(identity.clientId,normalized.taxId,publicId))this.duplicate();try{const row=await this.repository.update(identity.clientId,publicId,identity.userId,normalized);if(!row)throw new ErpDomainError("NOT_FOUND","Fornecedor não encontrado.");const item=supplierPublic(row);await this.publish(identity.clientId,publicId,"updated");return item;}catch(error){if(databaseCode(error)==="ER_DUP_ENTRY")this.duplicate();throw error;}}
  async setActive(identity:Identity,publicId:string,active:boolean){this.assertWrite(identity);if(!await this.repository.setActive(identity.clientId,publicId,identity.userId,active))throw new ErpDomainError("NOT_FOUND","Fornecedor não encontrado.");await this.publish(identity.clientId,publicId,active?"activated":"deactivated");return{ok:true};}
}
