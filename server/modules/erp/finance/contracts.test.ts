import { describe,expect,it } from "vitest";
import { canReadFinance,canWriteFinance,financeEvent,financeListInput,isOverdue,manualEntryInput,signedSettlementAmount } from "./contracts";
describe("finance contracts",()=>{
 it("accepts nullable optional text sent by the Finance UI",()=>{expect(manualEntryInput.parse({documentNumber:"NULL-1",direction:"payable",description:"Sem observações",amountCents:100,dueDate:"2026-09-20",issueDate:"2026-08-24",categoryPublicId:"11111111-1111-4111-8111-111111111111",financialAccountPublicId:null,supplierPublicId:null,crmClientId:null,partyName:null,notes:null}).notes).toBeNull()});
 it("uses signed cents and derives overdue without persisting it",()=>{expect(signedSettlementAmount("payable",1250)).toBe(-1250);expect(signedSettlementAmount("receivable",1250)).toBe(1250);expect(isOverdue("open","2025-01-01","2025-01-02")).toBe(true);expect(isOverdue("settled","2025-01-01","2025-01-02")).toBe(false)});
 it("enforces roles",()=>{expect(canReadFinance("viewer")).toBe(true);expect(canReadFinance("agent")).toBe(false);expect(canWriteFinance("manager")).toBe(true);expect(canWriteFinance("viewer")).toBe(false)});
 it("normalizes pagination, filters and sorting",()=>{const x=financeListInput.parse({search:" NF ",page:2,pageSize:25,sort:"amount",directionSort:"desc",overdue:true});expect(x).toMatchObject({search:"NF",page:2,pageSize:25,sort:"amount",directionSort:"desc",overdue:true})});
 it("builds a privacy-safe realtime payload",()=>{const x=financeEvent(crypto.randomUUID(),"settled","2026-01-01T00:00:00.000Z");expect(Object.keys(x).sort()).toEqual(["occurredAt","operation","publicId"]);expect(JSON.stringify(x)).not.toMatch(/amount|balance|client|supplier|account|tenant/i)});
});
