import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { validateTestDatabaseUrl } from "../../../test-integration-gates";
import { reportRequestInput } from "./contracts";
import { ReportsRepository } from "./repository";
import { ReportsService } from "./service";
const physical = process.env.RUN_DATABASE_INTEGRATION === "1";
const tenantA = "reports-a", tenantB = "reports-b";
const current = { from: "2026-08-01", to: "2026-08-10" };
let pool: Pool;

async function cleanup() {
  const tenants = [tenantA, tenantB];
  for (const sql of [
    "DELETE x FROM erp_fiscal_operations x JOIN erp_fiscal_documents d ON d.id=x.fiscal_document_id WHERE d.client_id IN (?,?)",
    "DELETE x FROM erp_fiscal_document_history x JOIN erp_fiscal_documents d ON d.id=x.fiscal_document_id WHERE d.client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_items WHERE client_id IN (?,?)","DELETE FROM erp_fiscal_documents WHERE client_id IN (?,?)","DELETE FROM erp_product_fiscal_profiles WHERE client_id IN (?,?)","DELETE x FROM erp_fiscal_settings_history x JOIN erp_fiscal_settings s ON s.id=x.settings_id WHERE s.client_id IN (?,?)","DELETE FROM erp_fiscal_settings WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_ledger WHERE client_id IN (?,?)","DELETE FROM erp_financial_settlements WHERE client_id IN (?,?)","DELETE FROM erp_financial_entries WHERE client_id IN (?,?)","DELETE FROM erp_financial_categories WHERE client_id IN (?,?)","DELETE FROM erp_financial_accounts WHERE client_id IN (?,?)",
    "DELETE x FROM erp_sale_order_items x JOIN erp_sale_orders o ON o.id=x.sale_order_id WHERE o.client_id IN (?,?)","DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE x FROM erp_purchase_order_items x JOIN erp_purchase_orders o ON o.id=x.purchase_order_id WHERE o.client_id IN (?,?)","DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_movements WHERE client_id IN (?,?)","DELETE FROM erp_stock_balances WHERE client_id IN (?,?)","DELETE FROM erp_suppliers WHERE client_id IN (?,?)","DELETE FROM erp_products WHERE client_id IN (?,?)","DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN (?,?)","DELETE FROM megadesk_domain_client_users WHERE client_id IN (?,?)","DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)",
  ]) await pool.execute(sql, tenants);
}

async function insert(sql: string, values: unknown[] = []) {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  return result.insertId;
}
async function verifySchema() {
  const required=["megadesk_domain_clients","megadesk_domain_client_users","megadesk_operational_sessions","megadesk_crm_clients","erp_products","erp_stock_balances","erp_stock_movements","erp_suppliers","erp_purchase_orders","erp_purchase_order_items","erp_sale_orders","erp_sale_order_items","erp_financial_accounts","erp_financial_categories","erp_financial_entries","erp_financial_settlements","erp_financial_ledger","erp_fiscal_settings","erp_product_fiscal_profiles","erp_fiscal_documents"];
  const [rows]=await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)",[required]);
  const present=new Set(rows.map(row=>String(row.TABLE_NAME??row.table_name))); const missing=required.filter(table=>!present.has(table));
  if(missing.length) throw new Error(`Schema fÃ­sico incompleto para RelatÃ³rios: ${missing.join(", ")}`);
}

async function fixtures() {
  await cleanup();
  await pool.execute("INSERT INTO megadesk_domain_clients(client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES (?,'reports-int-a','reports_a','Reports A','Fixture','00000000000','Test','active','test',1,'reports-a','[\"erp\"]','{}'),(?,'reports-int-b','reports_b','Reports B','Fixture','00000000001','Test','active','test',1,'reports-b','[\"erp\"]','{}')",[tenantA,tenantB]);
  await pool.execute("INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status,created_at) VALUES ('ra-client-z',?,'Zulu Cliente','ativo','2026-08-02'),('ra-client-a',?,'Alpha Cliente','ativo','2026-08-03'),('ra-client-i',?,'Inativo Cliente','inativo','2026-07-25'),('rb-client',?,'SENTINELA CLIENTE B','ativo','2026-08-02')",[tenantA,tenantA,tenantA,tenantB]);
  const productIds: number[]=[];
  for(const [publicId,clientId,name,sku,min,active] of [["ra-prod-a",tenantA,"Alpha Produto","SKU-A",5,1],["ra-prod-b",tenantA,"Beta Produto","SKU-B",1,1],["ra-prod-c",tenantA,"Charlie Produto","SKU-C",5,1],["ra-prod-d",tenantA,"Delta Produto","SKU-D",0,1],["rb-prod",tenantB,"SENTINELA PRODUTO B","SKU-BB",0,1]] as const)
    productIds.push(await insert("INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by,created_at) VALUES (?,?,?,?, 'unit',100,200,?,?, 'fixture','2026-08-01')",[publicId,clientId,name,sku,min,active]));
  await pool.execute("INSERT INTO erp_stock_balances(client_id,product_id,quantity) VALUES (?,?,10),(?,?,0),(?,?,2),(?,?,20),(?,?,99)",[tenantA,productIds[0],tenantA,productIds[1],tenantA,productIds[2],tenantA,productIds[3],tenantB,productIds[4]]);
  for(const [id,type,direction,quantity,product,date] of [["ra-move-p","purchase_in","in",5,productIds[0],"2026-08-02"],["ra-move-s","sale_out","out",2,productIds[0],"2026-08-03"],["ra-move-m","manual_in","in",1,productIds[2],"2026-08-04"],["rb-move","manual_in","in",99,productIds[4],"2026-08-04"]] as const)
    await pool.execute("INSERT INTO erp_stock_movements(public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,idempotency_key,payload_hash,created_by,created_at) VALUES (?,?,?,?,?,?,0,?, 'fixture',?,REPEAT('a',64),'fixture',?)",[id,id.startsWith("rb")?tenantB:tenantA,product,type,direction,quantity,quantity,`${id}-key`,date]);
  const suppliers:number[]=[];
  for(const [id,clientId,name,active,date] of [["ra-sup-z",tenantA,"Zulu Fornecedor",1,"2026-08-02"],["ra-sup-a",tenantA,"Alpha Fornecedor",1,"2026-07-25"],["ra-sup-i",tenantA,"Inativo Fornecedor",0,"2026-08-03"],["rb-sup",tenantB,"SENTINELA FORNECEDOR B",1,"2026-08-02"]] as const)
    suppliers.push(await insert("INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,active,created_by,created_at) VALUES (?,?,?,'legal',?,'fixture',?)",[id,clientId,name,active,date]));
  const purchases:Array<[number,string]> = [];
  for(const [id,clientId,num,supplier,status,total,created,received] of [["ra-po-d",tenantA,"PO-001",suppliers[0],"draft",9900,"2026-08-02",null],["ra-po-a",tenantA,"PO-002",suppliers[0],"approved",8800,"2026-08-03",null],["ra-po-r",tenantA,"PO-003",suppliers[1],"received",6000,"2026-08-04","2026-08-05"],["ra-po-prev",tenantA,"PO-004",suppliers[1],"received",2000,"2026-07-25","2026-07-25"],["ra-po-c",tenantA,"PO-005",suppliers[0],"cancelled",7700,"2026-08-06",null],["rb-po",tenantB,"PO-B-001",suppliers[3],"received",999999,"2026-08-04","2026-08-05"]] as const) {
    const orderId=await insert("INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,received_at,received_by,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,IF(? IS NULL,NULL,'fixture'),'fixture',?)",[id,clientId,num,supplier,String(num).startsWith("PO-B")?"SENTINELA FORNECEDOR B":supplier===suppliers[1]?"Alpha Fornecedor":"Zulu Fornecedor",status,total,total,received,received,created]); purchases.push([orderId,id]);
  }
  await pool.execute("INSERT INTO erp_purchase_order_items(public_id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,line_total_cents) VALUES ('ra-poi-r',?,?, 'Alpha Produto','SKU-A',3,2000,6000),('ra-poi-prev',?,?, 'Alpha Produto','SKU-A',1,2000,2000),('rb-poi',?,?, 'SENTINELA PRODUTO B','SKU-BB',9,111111,999999)",[purchases[2][0],productIds[0],purchases[3][0],productIds[0],purchases[5][0],productIds[4]]);
  const sales:Array<[number,string]> = [];
  for(const [id,clientId,num,customer,name,status,total,created,fulfilled] of [["ra-so-d",tenantA,"SO-001","ra-client-z","Zulu Cliente","draft",9000,"2026-08-02",null],["ra-so-co",tenantA,"SO-002","ra-client-z","Zulu Cliente","confirmed",8000,"2026-08-03",null],["ra-so-f1",tenantA,"SO-003","ra-client-a","Alpha Cliente","fulfilled",3000,"2026-08-04","2026-08-05"],["ra-so-f2",tenantA,"SO-004","ra-client-z","Zulu Cliente","fulfilled",5000,"2026-08-05","2026-08-06"],["ra-so-prev",tenantA,"SO-005","ra-client-a","Alpha Cliente","fulfilled",2000,"2026-07-25","2026-07-25"],["ra-so-c",tenantA,"SO-006","ra-client-z","Zulu Cliente","cancelled",7000,"2026-08-06",null],["rb-so",tenantB,"SO-B-001","rb-client","SENTINELA CLIENTE B","fulfilled",999999,"2026-08-04","2026-08-05"]] as const) {
    const orderId=await insert("INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,fulfilled_at,fulfilled_by,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,IF(? IS NULL,NULL,'fixture'),'fixture',?)",[id,clientId,num,customer,name,status,total,total,fulfilled,fulfilled,created]); sales.push([orderId,id]);
  }
  await pool.execute("INSERT INTO erp_sale_order_items(public_id,sale_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents) VALUES ('ra-soi-f1',?,?, 'Alpha Produto','SKU-A',2,1500,3000),('ra-soi-f2',?,?, 'Beta Produto','SKU-B',5,1000,5000),('ra-soi-prev',?,?, 'Alpha Produto','SKU-A',1,2000,2000),('rb-soi',?,?, 'SENTINELA PRODUTO B','SKU-BB',9,111111,999999)",[sales[2][0],productIds[0],sales[3][0],productIds[1],sales[4][0],productIds[0],sales[6][0],productIds[4]]);
  await financialAndFiscalFixtures(productIds);
}

async function financialAndFiscalFixtures(productIds: number[]) {
  const accountA=await insert("INSERT INTO erp_financial_accounts(public_id,client_id,name,type,initial_balance_cents,current_balance_cents,active,created_by) VALUES ('ra-account',?,'Conta A','bank',10000,13000,1,'fixture')",[tenantA]);
  await insert("INSERT INTO erp_financial_accounts(public_id,client_id,name,type,initial_balance_cents,current_balance_cents,active,created_by) VALUES ('rb-account',?,'SENTINELA CONTA B','bank',999999,999999,1,'fixture')",[tenantB]);
  const categoryA=await insert("INSERT INTO erp_financial_categories(public_id,client_id,name,direction) VALUES ('ra-category',?,'Categoria A','both')",[tenantA]);
  const categoryB=await insert("INSERT INTO erp_financial_categories(public_id,client_id,name,direction) VALUES ('rb-category',?,'SENTINELA CATEGORIA B','both')",[tenantB]);
  const entries:Array<[number,string,string,number]> = [];
  for(const [id,clientId,num,direction,status,amount,due,issue,settled,party,category,account] of [
    ["ra-fin-po-over",tenantA,"FIN-001","payable","open",1000,"2000-01-01","2026-08-02",null,"Alpha Fornecedor",categoryA,null],
    ["ra-fin-po-next",tenantA,"FIN-002","payable","open",2000,"2090-01-01","2026-08-03",null,"Zulu Fornecedor",categoryA,null],
    ["ra-fin-ps",tenantA,"FIN-003","payable","settled",1500,"2026-08-04","2026-08-04","2026-08-05","Alpha Fornecedor",categoryA,accountA],
    ["ra-fin-pc",tenantA,"FIN-004","payable","cancelled",9000,"2026-08-04","2026-08-04",null,"Cancelado",categoryA,null],
    ["ra-fin-ro",tenantA,"FIN-005","receivable","open",3000,"2090-01-01","2026-08-05",null,"Alpha Cliente",categoryA,null],
    ["ra-fin-rs",tenantA,"FIN-006","receivable","settled",4500,"2026-08-05","2026-08-05","2026-08-06","Zulu Cliente",categoryA,accountA],
    ["ra-fin-rc",tenantA,"FIN-007","receivable","cancelled",8000,"2026-08-05","2026-08-05",null,"Cancelado",categoryA,null],
    ["rb-fin",tenantB,"FIN-B-001","receivable","open",999999,"2090-01-01","2026-08-05",null,"SENTINELA FINANCEIRO B",categoryB,null],
  ] as const) {
    const entryId=await insert("INSERT INTO erp_financial_entries(public_id,client_id,document_number,direction,status,description,amount_cents,due_date,issue_date,category_id,financial_account_id,source_type,party_name_snapshot,settled_at,settled_by,created_by) VALUES (?,?,?,?,?,'fixture',?,?,?,?,?,'manual',?,?,IF(? IS NULL,NULL,'fixture'),'fixture')",[id,clientId,num,direction,status,amount,due,issue,category,account,party,settled,settled]); entries.push([entryId,id,direction,amount]);
  }
  for(const index of [2,5]) { const [entryId,id,direction,amount]=entries[index]; const settlement=await insert("INSERT INTO erp_financial_settlements(public_id,client_id,financial_entry_id,financial_account_id,idempotency_key,amount_cents,settled_by,settled_at) VALUES (?,?,?, ?,?,?, 'fixture',?)",[`${id}-settle`,tenantA,entryId,accountA,`${id}-key`,amount,index===2?"2026-08-05":"2026-08-06"]); await pool.execute("INSERT INTO erp_financial_ledger(public_id,client_id,financial_account_id,financial_entry_id,settlement_id,type,amount_cents,previous_balance_cents,resulting_balance_cents,occurred_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'fixture')",[`${id}-ledger`,tenantA,accountA,entryId,settlement,direction==="payable"?"payable_settlement":"receivable_settlement",amount,10000,direction==="payable"?8500:13000,index===2?"2026-08-05":"2026-08-06"]); }
  await pool.execute("INSERT INTO erp_fiscal_settings(public_id,client_id,tax_regime,taxpayer_indicator,status,updated_by) VALUES ('ra-fiscal-settings',?,'simples_nacional','taxpayer','incomplete','fixture'),('rb-fiscal-settings',?,'simples_nacional','taxpayer','incomplete','fixture')",[tenantA,tenantB]);
  await pool.execute("INSERT INTO erp_product_fiscal_profiles(public_id,client_id,product_id,fiscal_unit,completeness,updated_by) VALUES ('ra-profile-complete',?,?,'UN','complete','fixture'),('ra-profile-incomplete',?,?,'UN','incomplete','fixture')",[tenantA,productIds[0],tenantA,productIds[1]]);
  for(const [id,clientId,num,type,status,date,party,total] of [["ra-fiscal-d",tenantA,"FIS-001","manual","draft","2026-08-02","Manual A",1000],["ra-fiscal-r",tenantA,"FIS-002","sale","ready_for_integration","2026-08-03","Alpha Cliente",3000],["ra-fiscal-c",tenantA,"FIS-003","purchase","cancelled","2026-08-04","Alpha Fornecedor",6000],["rb-fiscal",tenantB,"FIS-B-001","manual","draft","2026-08-02","SENTINELA FISCAL B",999999]] as const)
    await pool.execute("INSERT INTO erp_fiscal_documents(public_id,client_id,internal_number,type,status,internal_issue_date,party_name_snapshot,total_cents,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?, 'fixture','fixture')",[id,clientId,num,type,status,date,party,total]);
}
describe.runIf(physical)("reports mysql risk matrix", () => {
  let service: ReportsService;
  beforeAll(async () => {
    const url=process.env.TEST_DATABASE_URL;
    if(!url) throw new Error("TEST_DATABASE_URL Ã© obrigatÃ³ria para RelatÃ³rios fÃ­sicos.");
    pool=mysql.createPool(validateTestDatabaseUrl(url));
    await verifySchema();
    await fixtures();
    service = new ReportsService(new ReportsRepository(pool));
  }, 60_000);
  afterAll(async()=>{try{await cleanup();}finally{await pool.end();}});
  const admin = {
      clientId: tenantA,
      userId: "admin",
      role: "admin" as const,
    },
    period = {
      ...current,
      page: 1,
      pageSize: 20,
      sort: "date" as const,
      direction: "desc" as const,
    };
  it("aggregates exact essential metrics and equal previous periods", async () => {
    const sales=await service.report(admin,{...period,section:"sales"}) as any;
    expect(sales.data.summary).toEqual({fulfilledCount:2,fulfilledValueCents:8000,averageTicketCents:4000});
    expect(Object.fromEntries(sales.data.byStatus.map((x:any)=>[x.status,[Number(x.count),Number(x.valueCents)]]))).toEqual({draft:[1,9000],confirmed:[1,8000],fulfilled:[2,8000],cancelled:[1,7000]});
    expect(sales.data.topProducts.map((x:any)=>[x.name,Number(x.quantityMillis),Number(x.valueCents)])).toEqual([["Beta Produto",5000,5000],["Alpha Produto",2000,3000]]);
    const purchases=await service.report(admin,{...period,section:"purchases"}) as any;
    expect(purchases.data.summary).toEqual({receivedCount:1,receivedValueCents:6000,averageTicketCents:6000});
    expect(Object.fromEntries(purchases.data.byStatus.map((x:any)=>[x.status,[Number(x.count),Number(x.valueCents)]]))).toEqual({draft:[1,9900],approved:[1,8800],received:[1,6000],cancelled:[1,7700]});
    expect(purchases.data.topProducts.map((x:any)=>[x.name,Number(x.quantityMillis),Number(x.valueCents)])).toEqual([["Alpha Produto",3000,6000]]);
    const stock=await service.report(admin,{...period,section:"stock",sort:"product"}) as any;
    expect(stock.data.summary).toMatchObject({zeroStock:1,lowStock:2});
    expect(Object.fromEntries(stock.data.byType.map((x:any)=>[x.type,[x.direction,Number(x.quantityMillis),Number(x.count)]]))).toEqual({purchase_in:["in",5000,1],sale_out:["out",2000,1],manual_in:["in",1000,1]});
    expect(stock.data.items.map((x:any)=>[x.name,Number(x.quantityMillis)])).toEqual([["Delta Produto",20000],["Charlie Produto",2000],["Beta Produto",0],["Alpha Produto",10000]]);
    const finance=await service.report(admin,{...period,section:"finance"}) as any;
    expect(finance.data.summary).toMatchObject({openPayable:2,openReceivable:1,overdue:1,upcoming:2});
    expect(finance.data.accounts).toEqual([{publicId:"ra-account",name:"Conta A",balanceCents:13000}]);
    expect(Object.fromEntries(finance.data.ledger.map((x:any)=>[x.type,[Number(x.valueCents),Number(x.count)]]))).toEqual({payable_settlement:[1500,1],receivable_settlement:[4500,1]});
    const clients=await service.report(admin,{...period,section:"clients",sort:"salesTotal"}) as any;
    expect(clients.data.summary).toMatchObject({activeClients:2,newClients:2});
    expect(clients.data.items.map((x:any)=>[x.name,Number(x.valueCents)])).toEqual([["Zulu Cliente",5000],["Alpha Cliente",3000],["Inativo Cliente",0]]);
    const suppliers=await service.report(admin,{...period,section:"suppliers",sort:"purchasesTotal"}) as any;
    expect(suppliers.data.summary).toMatchObject({activeSuppliers:2,newSuppliers:2});
    expect(suppliers.data.items.map((x:any)=>[x.name,Number(x.valueCents)])).toEqual([["Alpha Fornecedor",6000],["Zulu Fornecedor",0],["Inativo Fornecedor",0]]);
    const fiscal=await service.report(admin,{...period,section:"fiscal"}) as any;
    expect(fiscal.data.summary).toEqual({incompleteProducts:3,incompleteSettings:1});
    expect(Object.fromEntries(fiscal.data.byStatus.map((x:any)=>[x.status,Number(x.count)]))).toEqual({draft:1,ready_for_integration:1,cancelled:1});
    expect(Object.fromEntries(fiscal.data.byOrigin.map((x:any)=>[x.origin,Number(x.count)]))).toEqual({manual:1,sale:1,purchase:1});
    const executive=await service.report(admin,{...period,section:"executive",sort:undefined}) as any;
    expect(executive.data.sales).toMatchObject({count:2,valueCents:8000}); expect(executive.data.purchases).toMatchObject({count:1,valueCents:6000});
    expect(executive.data.settlements).toEqual({receivedCents:4500,paidCents:1500});
    expect(executive.comparison.fulfilledSalesValueCents).toEqual({current:8000,previous:2000,absoluteChange:6000,percentageChange:300});
    expect(executive.comparison.receivedCents.percentageChange).toBeNull();
  });
  it("keeps tenant B isolated and agent blocked before queries", async () => {
    for(const role of ["admin","manager","viewer"] as const) await expect(service.report({...admin,role},{...period,section:"sales"})).resolves.toMatchObject({section:"sales"});
    await expect(service.exportCsv({...admin,role:"viewer"},{...period,section:"sales",maxRows:100})).rejects.toMatchObject({code:"FORBIDDEN"});
    for(const role of ["admin","manager"] as const) await expect(service.exportCsv({...admin,role},{...period,section:"sales",maxRows:100})).resolves.toMatchObject({contentType:"text/csv; charset=utf-8"});
    const report=vi.fn(), guarded=new ReportsService({report} as any);
    await expect(guarded.report({...admin,role:"agent"},{...period,section:"sales"})).rejects.toMatchObject({code:"FORBIDDEN"}); expect(report).not.toHaveBeenCalled();
    const b=await service.report({...admin,clientId:tenantB},{...period,section:"sales"}) as any;
    expect(b.data.items).toHaveLength(1); expect(JSON.stringify(b)).toContain("SENTINELA CLIENTE B"); expect(JSON.stringify(b)).not.toContain("Alpha Cliente");
    const cross=await service.report(admin,{...period,section:"sales",publicId:"rb-client"}) as any; expect(cross.data).toMatchObject({items:[],total:0,totalPages:0});
    const dto=JSON.stringify(await service.report(admin,{...period,section:"clients",sort:"name"}));
    expect(dto).not.toMatch(/"(?:id|clientId|tenantId|cpfCnpj|phone|email|address|observations|notes)"/i);
  });
  it("supports pagination, filters and safe export", async () => {
    const first=await service.report(admin,{...period,section:"sales",page:1,pageSize:2,sort:"number",direction:"asc"}) as any;
    const second=await service.report(admin,{...period,section:"sales",page:2,pageSize:2,sort:"number",direction:"asc"}) as any;
    expect(first.data).toMatchObject({page:1,pageSize:2,total:5,totalPages:3}); expect(second.data).toMatchObject({page:2,pageSize:2,total:5,totalPages:3});
    expect(first.data.items.map((x:any)=>x.number)).toEqual(["SO-001","SO-002"]); expect(second.data.items.map((x:any)=>x.number)).toEqual(["SO-003","SO-004"]);
    const desc=await service.report(admin,{...period,section:"sales",page:1,pageSize:2,sort:"number",direction:"desc"}) as any; expect(desc.data.items.map((x:any)=>x.number)).toEqual(["SO-006","SO-004"]);
    const filtered=await service.report(admin,{...period,section:"sales",status:"fulfilled",sort:"date"}) as any; expect(filtered.data).toMatchObject({total:2,totalPages:1}); expect(filtered.data.items.map((x:any)=>x.status)).toEqual(["fulfilled","fulfilled"]);
    for(const invalid of [{...period,section:"sales",sort:"supplier"},{...period,section:"sales",direction:"sideways"},{...period,section:"sales",from:"2026-08-10",to:"2026-08-01"},{...period,section:"sales",from:"2025-01-01",to:"2026-08-01"},{...period,section:"sales",pageSize:101}]) expect(reportRequestInput.safeParse(invalid).success).toBe(false);
    await pool.execute("INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by,created_at) VALUES ('ra-csv-eq',?,'CSV-01','ra-client-a','=FORMULA','draft',1,1,'fixture','2026-08-07'),('ra-csv-plus',?,'CSV-02','ra-client-a','+FORMULA','draft',1,1,'fixture','2026-08-07'),('ra-csv-minus',?,'CSV-03','ra-client-a','-FORMULA','draft',1,1,'fixture','2026-08-07'),('ra-csv-at',?,'CSV-04','ra-client-a','@FORMULA','draft',1,1,'fixture','2026-08-07'),('ra-csv-tab',?,'CSV-05','ra-client-a','\tFORMULA','draft',1,1,'fixture','2026-08-07'),('ra-csv-cr',?,'CSV-06','ra-client-a','\rFORMULA','draft',1,1,'fixture','2026-08-07')",Array(6).fill(tenantA));
    const csv=await service.exportCsv(admin,{...period,section:"sales",sort:"number",direction:"asc",maxRows:100}); expect(csv.contentType).toBe("text/csv; charset=utf-8"); expect(csv.fileName).toBe("megadesk-sales-2026-08-01-2026-08-10.csv"); for(const value of ["=FORMULA","+FORMULA","-FORMULA","@FORMULA","\tFORMULA","\rFORMULA"]) expect(csv.content).toContain(`'${value}`); expect(csv.content).not.toMatch(/client_id|cpf_cnpj|email|phone|address|observations/i);
    const placeholders=Array.from({length:1001},()=>"(?,?,?,'ra-client-a','Bulk Cliente','draft',1,1,'fixture','2026-08-08')").join(","), values:unknown[]=[]; for(let i=0;i<1001;i++) values.push(`ra-bulk-${String(i).padStart(4,"0")}`,tenantA,`BULK-${String(i).padStart(4,"0")}`);
    try { await pool.query(`INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by,created_at) VALUES ${placeholders}`,values); await expect(service.exportCsv(admin,{...period,section:"sales",sort:"number",direction:"asc",maxRows:1000})).rejects.toMatchObject({code:"VALIDATION"}); }
    finally { await pool.execute("DELETE FROM erp_sale_orders WHERE client_id=? AND order_number LIKE 'BULK-%'",[tenantA]); }
  });
});
