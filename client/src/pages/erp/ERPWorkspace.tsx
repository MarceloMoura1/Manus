import React from "react";
import { io } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, Boxes, Image as ImageIcon, PackagePlus, RefreshCw, Search, Trash2, TrendingDown, Upload, WalletCards } from "lucide-react";
import { SuppliersPage } from "./SuppliersPage";
import { ClientesPage } from "../ClientesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import { PurchasesPage } from "./PurchasesPage";
import { SalesPage } from "./SalesPage";
import { FinancePage } from "./FinancePage";
import { FiscalPage } from "./FiscalPage";
import { ReportsPage } from "./ReportsPage";
import type { ModuleTopbarItem } from "@/components/ModuleTopbar";

export type ErpSection = "summary" | "clients" | "products" | "stock" | "suppliers" | "purchases" | "sales" | "finance" | "fiscal" | "reports";
const planned = ["Integrações"];

export function getErpTopbarItems({
  canAccessClients,
  canAccessFinance,
  canAccessFiscal,
  canAccessReports,
  onNavigate,
}: {
  canAccessClients: boolean;
  canAccessFinance: boolean;
  canAccessFiscal: boolean;
  canAccessReports: boolean;
  onNavigate: (section: ErpSection) => void;
}): ModuleTopbarItem[] {
  const available = [
    {id:"summary" as const,label:"Resumo"},
    {id:"clients" as const,label:"Clientes",hidden:!canAccessClients},
    {id:"products" as const,label:"Produtos"},
    {id:"stock" as const,label:"Estoque"},
    {id:"suppliers" as const,label:"Fornecedores"},
    {id:"purchases" as const,label:"Compras"},
    {id:"sales" as const,label:"Vendas"},
    {id:"finance" as const,label:"Financeiro",hidden:!canAccessFinance},
    {id:"fiscal" as const,label:"Fiscal",hidden:!canAccessFiscal},
    {id:"reports" as const,label:"Relatórios",hidden:!canAccessReports},
  ];

  return [
    ...available.map(item => ({ ...item, onSelect: () => onNavigate(item.id) })),
    ...planned.map(label => ({ id: `planned-${label}`, label, disabled: true, unavailableReason: "Em preparação" })),
  ];
}
type ProductForm = { publicId?: string; name: string; sku: string; barcode: string; category: string; unit: "unit" | "kg" | "liter" | "meter"; cost: string; sale: string; minimumStock: string; description: string };
type StockForm = { productPublicId: string; type: "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out"; quantity: string; reason: string; idempotencyKey: string };
type StockFilterType = "all" | "initial" | "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out" | "purchase_in" | "sale_out" | "reversal";
const emptyProduct: ProductForm = { name: "", sku: "", barcode: "", category: "", unit: "unit", cost: "0,00", sale: "0,00", minimumStock: "0", description: "" };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cents = (value: string) => { const normalized = value.replace(/\./g, "").replace(",", "."); const parsed = Number(normalized); return Number.isFinite(parsed) ? Math.round(parsed * 100) : -1; };
const formatQuantity = (value: string) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const newKey = () => crypto.randomUUID();

function useErpRealtime() {
  const utils = trpc.useUtils();
  React.useEffect(() => {
    const socket = io(window.location.origin, { path: "/api/ws/whatsapp", withCredentials: true });
    let refreshTimer: number | undefined;
    const refresh = () => { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void utils.erp.reports.invalidate(), 250); };
    const refreshSuppliers = () => { refresh(); };
    socket.on("connect", refresh);
    socket.on("erp:product.changed", refresh);
    socket.on("erp:stock.changed", refresh);
    socket.on("erp:supplier.changed", refreshSuppliers);
    socket.on("erp:purchase.changed", refresh);
    socket.on("erp:sale.changed", refresh);
    socket.on("erp:finance.entry.changed", refresh);
    socket.on("erp:finance.account.changed", refresh);
    socket.on("erp:fiscal.document.changed", refresh);
    socket.on("erp:fiscal.settings.changed", refresh);
    return () => {
      window.clearTimeout(refreshTimer);
      socket.off("connect", refresh);
      socket.off("erp:product.changed", refresh);
      socket.off("erp:stock.changed", refresh);
      socket.off("erp:supplier.changed", refreshSuppliers);
      socket.off("erp:purchase.changed", refresh);
      socket.off("erp:sale.changed", refresh);
      socket.off("erp:finance.entry.changed", refresh);
      socket.off("erp:finance.account.changed", refresh);
      socket.off("erp:fiscal.document.changed", refresh);
      socket.off("erp:fiscal.settings.changed", refresh);
      socket.disconnect();
    };
  }, [utils]);
}

function StateMessage({ title, retry }: { title: string; retry?: () => void }) {
  return <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><AlertCircle className="mx-auto mb-3 h-7 w-7 text-slate-400"/><p className="font-semibold text-slate-800">{title}</p>{retry && <Button className="mt-4" variant="outline" onClick={retry}><RefreshCw className="mr-2 h-4 w-4"/>Tentar novamente</Button>}</div>;
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <nav aria-label="Paginação" className="flex flex-wrap items-center justify-end gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button><span className="text-sm text-slate-600">Página {page} de {totalPages}</span><Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Próxima</Button></nav>;
}

export function ERPWorkspace({ section, onNavigate, canAccessClients, canAccessFinance, canAccessFiscal, canAccessReports, initialCrmClientId, onClientNavigate, whatsappConnected, canStartConversation }: { section: ErpSection; onNavigate: (section: ErpSection) => void; canAccessClients: boolean; canAccessFinance: boolean; canAccessFiscal: boolean; canAccessReports: boolean; initialCrmClientId?: string; onClientNavigate: (intent: CrmWhatsAppIntent) => void; whatsappConnected: boolean; canStartConversation: boolean }) {
  useErpRealtime();
  const denied = <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-bold text-slate-900">Acesso indisponível</h1><p className="mt-2 text-sm text-slate-600">Este módulo não está disponível para o seu perfil.</p></div>;
  const content = section === "summary" ? <Summary onNavigate={onNavigate}/> : section === "clients" ? canAccessClients ? <ClientesPage initialSelectedId={initialCrmClientId} onNavigate={onClientNavigate} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation}/> : denied : section === "products" ? <Products/> : section === "suppliers" ? <SuppliersPage/> : section === "purchases" ? <PurchasesPage/> : section === "sales" ? <SalesPage/> : section === "finance" ? canAccessFinance ? <FinancePage/> : denied : section === "fiscal" ? canAccessFiscal ? <FiscalPage/> : denied : section === "reports" ? canAccessReports ? <ReportsPage/> : denied : <Stock/>;
  return <div className="min-w-0 max-w-full" data-testid="erp-workspace">{content}</div>;
}

function Summary({ onNavigate }: { onNavigate: (section: ErpSection) => void }) {
  const query = trpc.erp.summary.useQuery();
  if (query.isLoading) return <StateMessage title="Carregando resumo do ERP…"/>;
  if (query.error) return <StateMessage title="Não foi possível carregar o resumo." retry={() => void query.refetch()}/>;
  if (!query.data) return null;
  const data = query.data;
  const cards = [
    ["Produtos ativos", data.metrics.activeProducts, Boxes], ["Produtos inativos", data.metrics.inactiveProducts, Boxes],
    ["Estoque baixo", data.metrics.lowProducts, TrendingDown], ["Sem estoque", data.metrics.emptyProducts, AlertCircle],
    ["Valor pelo custo", money.format(data.metrics.costValueCents / 100), WalletCards], ["Potencial de venda", money.format(data.metrics.saleValueCents / 100), WalletCards],
  ] as const;
  return <div className="space-y-6" data-testid="erp-summary-page">
    <header><h1 className="text-2xl font-bold text-slate-900">Resumo do ERP</h1></header>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label,value,Icon]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Icon className="mb-3 h-5 w-5 text-blue-600"/><p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-words text-2xl font-bold text-slate-900">{value}</p></article>)}</div>
    {data.metrics.activeProducts + data.metrics.inactiveProducts === 0 ? <StateMessage title="Nenhum produto cadastrado. Cadastre o primeiro produto para iniciar o estoque."/> : <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Estoque crítico</h2>{data.critical.length ? data.critical.map(product => <p key={product.publicId} className="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span>{product.name}</span><span>{formatQuantity(product.quantity)} / mín. {formatQuantity(product.minimumStock)}</span></p>) : <p className="mt-3 text-sm text-slate-500">Nenhum alerta.</p>}</section><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Movimentações recentes</h2>{data.recent.length ? data.recent.map(item => <p key={item.publicId} className="mt-3 text-sm">{item.productName}: {item.direction === "in" ? "+" : "-"}{formatQuantity(item.quantity)}</p>) : <p className="mt-3 text-sm text-slate-500">Nenhuma movimentação.</p>}</section></div>}
    {data.canWrite && <div className="flex flex-wrap gap-3"><Button onClick={() => onNavigate("products")}><PackagePlus className="mr-2 h-4 w-4"/>Cadastrar produto</Button><Button variant="outline" onClick={() => onNavigate("stock")}>Movimentar estoque</Button></div>}
  </div>;
}

function ProductThumbnail({product,className="h-12 w-12",version=0}:{product:{publicId:string;name:string;hasImage?:boolean};className?:string;version?:number}) {
  const [failed,setFailed]=React.useState(false);
  React.useEffect(()=>setFailed(false),[product.publicId,product.hasImage,version]);
  const frame=`${className} shrink-0 overflow-hidden rounded-lg bg-slate-100`;
  if(!product.hasImage||failed)return <div className={`${frame} flex items-center justify-center`} data-testid="product-image-placeholder" aria-label={`Sem foto para ${product.name}`}><ImageIcon className="h-5 w-5 text-slate-400"/></div>;
  return <img src={`/api/products/${product.publicId}/image?variant=thumbnail&v=${version}`} alt={`Foto de ${product.name}`} loading="lazy" decoding="async" className={`${frame} object-cover`} onError={()=>setFailed(true)}/>;
}

function Products() {
  const utils = trpc.useUtils();
  const [search,setSearch]=React.useState(""); const [active,setActive]=React.useState<"all"|"active"|"inactive">("all"); const [category,setCategory]=React.useState(""); const [stock,setStock]=React.useState<"all"|"empty"|"low"|"normal">("all"); const [sort,setSort]=React.useState<"name"|"sku"|"createdAt"|"stock">("name"); const [direction,setDirection]=React.useState<"asc"|"desc">("asc"); const [page,setPage]=React.useState(1); const [pageSize,setPageSize]=React.useState(20); const [form,setForm]=React.useState<ProductForm|null>(null); const [message,setMessage]=React.useState(""); const [photo,setPhoto]=React.useState<File|null>(null); const [photoPreview,setPhotoPreview]=React.useState<string|null>(null); const [removePhoto,setRemovePhoto]=React.useState(false); const [mediaPending,setMediaPending]=React.useState(false); const [mediaVersions,setMediaVersions]=React.useState<Record<string,number>>({});
  React.useEffect(()=>()=>{if(photoPreview?.startsWith("blob:"))URL.revokeObjectURL(photoPreview)},[photoPreview]);
  const resetPage = () => setPage(1);
  const query = trpc.erp.products.list.useQuery({ search, active: active === "all" ? undefined : active === "active", category: category || undefined, stock, sort, direction, page, pageSize });
  const done = async (text:string) => { setForm(null); setMessage(text); await utils.erp.invalidate(); };
  const create = trpc.erp.products.create.useMutation();
  const update = trpc.erp.products.update.useMutation();
  const status = trpc.erp.products.setActive.useMutation({ onSuccess: async () => { setMessage("Status atualizado com sucesso."); await utils.erp.invalidate(); } });
  const pending=create.isPending||update.isPending||mediaPending;
  const clearPhoto=()=>{if(photoPreview?.startsWith("blob:"))URL.revokeObjectURL(photoPreview);setPhoto(null);setPhotoPreview(null);setRemovePhoto(false)};
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if(!form||pending) return; const command={ name:form.name,sku:form.sku,barcode:form.barcode||undefined,description:form.description||undefined,category:form.category||undefined,unit:form.unit,costPriceCents:cents(form.cost),salePriceCents:cents(form.sale),minimumStock:form.minimumStock }; if(command.costPriceCents<0||command.salePriceCents<0){setMessage("Informe valores monetários válidos.");return;} try{const product=form.publicId?await update.mutateAsync({...command,publicId:form.publicId}):await create.mutateAsync(command);if(photo||removePhoto){setMediaPending(true);const response=await fetch(`/api/products/${product.publicId}/image`,photo?{method:"PUT",credentials:"include",headers:{"Content-Type":photo.type||"application/octet-stream","x-client-attempt-id":crypto.randomUUID()},body:photo}:{method:"DELETE",credentials:"include"});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||"Não foi possível salvar a foto.");}setMediaVersions(current=>({...current,[product.publicId]:(current[product.publicId]??0)+1}));}clearPhoto();await done(form.publicId?"Produto atualizado com sucesso.":"Produto cadastrado com sucesso.");}catch(error){setMessage(error instanceof Error?error.message:"Não foi possível salvar o produto.");}finally{setMediaPending(false);} };
  const edit = (product: NonNullable<typeof query.data>["items"][number]) => {clearPhoto();setPhotoPreview(product.hasImage?`/api/products/${product.publicId}/image?variant=thumbnail&v=${mediaVersions[product.publicId]??0}`:null);setForm({ publicId:product.publicId,name:product.name,sku:product.sku,barcode:product.barcode??"",category:product.category??"",unit:product.unit,cost:(product.costPriceCents/100).toFixed(2).replace(".",","),sale:(product.salePriceCents/100).toFixed(2).replace(".",","),minimumStock:product.minimumStock,description:product.description??"" });};
  const reset = () => { setSearch("");setActive("all");setCategory("");setStock("all");setSort("name");setDirection("asc");setPage(1); };
  const canWrite=query.data?.canWrite===true;
  return <div className="space-y-5" data-testid="erp-products-page">
    <header className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">Produtos</h1>{canWrite&&<Button onClick={()=>{clearPhoto();setForm({...emptyProduct})}}>Novo produto</Button>}</header>
    {message&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="relative sm:col-span-2"><span className="sr-only">Pesquisar produtos</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><Input className="pl-9" value={search} onChange={e=>{setSearch(e.target.value);resetPage()}} placeholder="Nome, SKU ou código de barras"/></label>
      <Filter label="Filtrar status" value={active} onChange={value=>{setActive(value as typeof active);resetPage()}} options={[["all","Todos"],["active","Ativos"],["inactive","Inativos"]]}/>
      <Input aria-label="Filtrar categoria" value={category} onChange={e=>{setCategory(e.target.value);resetPage()}} placeholder="Categoria"/>
      <Filter label="Filtrar estoque" value={stock} onChange={value=>{setStock(value as typeof stock);resetPage()}} options={[["all","Todo estoque"],["empty","Saldo zero"],["low","Estoque baixo"],["normal","Estoque normal"]]}/>
      <Filter label="Ordenar produtos" value={sort} onChange={value=>{setSort(value as typeof sort);resetPage()}} options={[["name","Nome"],["sku","SKU"],["createdAt","Cadastro"],["stock","Saldo"]]}/>
      <Filter label="Direção da ordenação" value={direction} onChange={value=>{setDirection(value as typeof direction);resetPage()}} options={[["asc","Crescente"],["desc","Decrescente"]]}/>
      <Filter label="Itens por página" value={String(pageSize)} onChange={value=>{setPageSize(Number(value));resetPage()}} options={[["10","10 por página"],["20","20 por página"],["50","50 por página"]]}/>
      <Button variant="outline" onClick={reset}>Limpar filtros</Button>
    </div>
    {query.isLoading?<StateMessage title="Carregando produtos…"/>:query.error?<StateMessage title={query.error.message||"Erro ao carregar produtos."} retry={()=>void query.refetch()}/>:query.data?.items.length===0?<StateMessage title={search||category||active!=="all"||stock!=="all"?"Nenhum produto corresponde aos filtros.":"Nenhum produto cadastrado."}/>:<div className="hidden overflow-x-auto rounded-2xl border bg-white md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Produto","SKU","Categoria","Custo","Venda","Saldo","Mínimo","Status",...(canWrite?["Ações"]:[])].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{query.data?.items.map(product=><tr key={product.publicId} className="border-t"><td className="p-3 font-medium"><div className="flex items-center gap-3"><ProductThumbnail product={product} version={mediaVersions[product.publicId]}/><span>{product.name}</span></div></td><td className="p-3">{product.sku}</td><td className="p-3">{product.category??"—"}</td><td className="p-3">{money.format(product.costPriceCents/100)}</td><td className="p-3">{money.format(product.salePriceCents/100)}</td><td className="p-3">{formatQuantity(product.quantity)}</td><td className="p-3">{formatQuantity(product.minimumStock)}</td><td className="p-3">{product.active?"Ativo":"Inativo"}</td>{canWrite&&<td className="p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>edit(product)}>Editar</Button><Button size="sm" variant="outline" onClick={()=>status.mutate({publicId:product.publicId,active:!product.active})} disabled={status.isPending}>{product.active?"Inativar":"Ativar"}</Button></div></td>}</tr>)}</tbody></table></div>}
    {query.data?.items.length?<div className="grid gap-3 md:hidden">{query.data.items.map(product=><article key={product.publicId} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><ProductThumbnail product={product} className="h-16 w-16" version={mediaVersions[product.publicId]}/><div className="min-w-0"><p className="truncate font-semibold">{product.name}</p><p className="truncate text-xs text-slate-500">{product.sku}</p></div></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{product.active?"Ativo":"Inativo"}</span></div><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-slate-500">Categoria</dt><dd>{product.category??"—"}</dd></div><div><dt className="text-slate-500">Saldo</dt><dd>{formatQuantity(product.quantity)}</dd></div><div><dt className="text-slate-500">Custo</dt><dd>{money.format(product.costPriceCents/100)}</dd></div><div><dt className="text-slate-500">Venda</dt><dd>{money.format(product.salePriceCents/100)}</dd></div></dl>{canWrite&&<div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={()=>edit(product)}>Editar</Button><Button size="sm" variant="outline" onClick={()=>status.mutate({publicId:product.publicId,active:!product.active})}>{product.active?"Inativar":"Ativar"}</Button></div>}</article>)}</div>:null}
    {query.data&&<Pagination page={page} totalPages={query.data.totalPages} onPage={setPage}/>}
    <Dialog open={Boolean(form)} onOpenChange={open=>{if(!open){clearPhoto();setForm(null)}}}><DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-xl"><DialogHeader><DialogTitle>{form?.publicId?"Editar produto":"Novo produto"}</DialogTitle></DialogHeader>{form&&<form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><span className="text-sm font-medium">Foto principal</span><div className="mt-2 flex items-center gap-4 rounded-xl border p-3">{photoPreview&&!removePhoto?<img src={photoPreview} alt="Prévia da foto do produto" className="h-24 w-24 rounded-lg object-cover"/>:<div className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100"><ImageIcon className="h-8 w-8 text-slate-400"/></div>}<div className="flex flex-wrap gap-2"><label aria-disabled={pending} className={`inline-flex items-center rounded-md border px-3 py-2 text-sm ${pending?"cursor-not-allowed opacity-50":"cursor-pointer"}`}><Upload className="mr-2 h-4 w-4"/>{photoPreview?"Substituir":"Selecionar"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={event=>{const file=event.currentTarget.files?.[0]??null;event.currentTarget.value="";if(file){if(photoPreview?.startsWith("blob:"))URL.revokeObjectURL(photoPreview);setPhoto(file);setPhotoPreview(URL.createObjectURL(file));setRemovePhoto(false)}}}/></label>{photoPreview&&<Button type="button" variant="outline" disabled={pending} onClick={()=>{if(window.confirm("Remover a foto principal deste produto?")){setPhoto(null);setPhotoPreview(null);setRemovePhoto(true)}}}><Trash2 className="mr-2 h-4 w-4"/>Remover</Button>}</div></div></div><Field label="Nome" value={form.name} onChange={name=>setForm({...form,name})}/><Field label="SKU" value={form.sku} onChange={sku=>setForm({...form,sku})}/><Field label="Código de barras" value={form.barcode} onChange={barcode=>setForm({...form,barcode})}/><Field label="Categoria" value={form.category} onChange={category=>setForm({...form,category})}/><Field label="Preço de custo" value={form.cost} onChange={cost=>setForm({...form,cost})}/><Field label="Preço de venda" value={form.sale} onChange={sale=>setForm({...form,sale})}/><Field label="Estoque mínimo" value={form.minimumStock} onChange={minimumStock=>setForm({...form,minimumStock})}/><label className="text-sm">Unidade<select className="mt-1 w-full rounded-lg border p-2" value={form.unit} onChange={e=>setForm({...form,unit:e.target.value as ProductForm["unit"]})}><option value="unit">Unidade</option><option value="kg">Quilograma</option><option value="liter">Litro</option><option value="meter">Metro</option></select></label><label className="text-sm sm:col-span-2">Descrição<textarea className="mt-1 w-full rounded-lg border p-2" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>{(create.error||update.error)&&<p role="alert" className="text-sm text-red-600 sm:col-span-2">{create.error?.message??update.error?.message}</p>}<div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={()=>{clearPhoto();setForm(null)}}>Cancelar</Button><Button type="submit" disabled={pending}>{pending?"Salvando…":"Salvar"}</Button></div></form>}</DialogContent></Dialog>
  </div>;
}

function Stock() {
  const utils=trpc.useUtils(); const [page,setPage]=React.useState(1); const [pageSize,setPageSize]=React.useState(20); const [search,setSearch]=React.useState(""); const [productFilter,setProductFilter]=React.useState(""); const [typeFilter,setTypeFilter]=React.useState<StockFilterType>("all"); const [from,setFrom]=React.useState(""); const [to,setTo]=React.useState(""); const [form,setForm]=React.useState<StockForm|null>(null); const [reverse,setReverse]=React.useState<{publicId:string;reason:string;idempotencyKey:string}|null>(null); const [detail,setDetail]=React.useState<string|null>(null); const [message,setMessage]=React.useState("");
  const products=trpc.erp.products.list.useQuery({search:"",active:true,stock:"all",sort:"name",direction:"asc",page:1,pageSize:100});
  const movements=trpc.erp.stock.list.useQuery({search,productPublicId:productFilter||undefined,type:typeFilter==="all"?undefined:typeFilter,from:from?new Date(from+"T00:00:00.000Z").toISOString():undefined,to:to?new Date(to+"T23:59:59.999Z").toISOString():undefined,page,pageSize});
  const move=trpc.erp.stock.move.useMutation({onSuccess:async()=>{setForm(null);setMessage("Movimentação registrada com sucesso.");await utils.erp.invalidate();}});
  const reverseMutation=trpc.erp.stock.reverse.useMutation({onSuccess:async()=>{setReverse(null);setMessage("Movimentação revertida com sucesso.");await utils.erp.invalidate();}});
  const selected=products.data?.items.find(item=>item.publicId===form?.productPublicId); const projected=form&&selected?(Number(selected.quantity)+(form.type.endsWith("out")?-1:1)*Number(form.quantity||0)):null;
  const canWrite=products.data?.canWrite===true; const submit=(event:React.FormEvent)=>{event.preventDefault();if(!form||move.isPending)return;move.mutate(form);};
  const reset=()=>{setSearch("");setProductFilter("");setTypeFilter("all");setFrom("");setTo("");setPage(1);};
  return <div className="space-y-5" data-testid="erp-stock-page">
    <header className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">Estoque</h1>{canWrite&&<Button onClick={()=>setForm({productPublicId:"",type:"manual_in",quantity:"",reason:"",idempotencyKey:newKey()})}>Nova movimentação</Button>}</header>
    {message&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{products.data?.items.map(product=><article key={product.publicId} className="rounded-2xl border bg-white p-4"><p className="font-semibold">{product.name}</p><p className="text-xs text-slate-500">{product.sku}</p><p className="mt-3 text-xl font-bold">{formatQuantity(product.quantity)} <span className="text-sm font-normal">{product.unit}</span></p><p className="text-xs text-slate-500">Mínimo: {formatQuantity(product.minimumStock)}</p></article>)}</section>
    <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Input aria-label="Pesquisar histórico" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Produto ou SKU"/>
      <Filter label="Filtrar produto" value={productFilter} onChange={value=>{setProductFilter(value);setPage(1)}} options={[["","Todos os produtos"],...(products.data?.items.map(item=>[item.publicId,item.name] as [string,string])??[])]}/>
      <Filter label="Filtrar tipo" value={typeFilter} onChange={value=>{setTypeFilter(value as StockFilterType);setPage(1)}} options={[["all","Todos os tipos"],["manual_in","Entrada"],["manual_out","Saída"],["adjustment_in","Ajuste positivo"],["adjustment_out","Ajuste negativo"],["reversal","Reversão"]]}/>
      <Filter label="Movimentos por página" value={String(pageSize)} onChange={value=>{setPageSize(Number(value));setPage(1)}} options={[["10","10 por página"],["20","20 por página"],["50","50 por página"]]}/>
      <label className="text-sm">De<Input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label><label className="text-sm">Até<Input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label><Button variant="outline" onClick={reset}>Limpar filtros</Button>
    </div>
    {movements.isLoading?<StateMessage title="Carregando movimentações…"/>:movements.error?<StateMessage title={movements.error.message||"Erro ao carregar movimentações."} retry={()=>void movements.refetch()}/>:movements.data?.items.length===0?<StateMessage title={search||productFilter||typeFilter!=="all"||from||to?"Nenhum movimento corresponde aos filtros.":"Nenhuma movimentação registrada."}/>:<div className="hidden overflow-x-auto rounded-2xl border bg-white md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Data","Produto","Tipo","Quantidade","Anterior","Posterior","Motivo","Estado","Detalhes",...(canWrite?["Ações"]:[])].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{movements.data?.items.map(item=><React.Fragment key={item.publicId}><tr className="border-t"><td className="p-3">{new Date(item.createdAt).toLocaleString("pt-BR")}</td><td className="p-3">{item.productName}<span className="block text-xs text-slate-500">{item.sku}</span></td><td className="p-3">{item.type}</td><td className="p-3">{item.direction==="in"?"+":"-"}{formatQuantity(item.quantity)}</td><td className="p-3">{formatQuantity(item.previousBalance)}</td><td className="p-3">{formatQuantity(item.resultingBalance)}</td><td className="p-3">{item.reason}</td><td className="p-3">{item.reversed?<span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">Revertido</span>:item.type==="reversal"?<span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">Reversão</span>:"Confirmado"}</td><td className="p-3"><Button size="sm" variant="outline" onClick={()=>setDetail(detail===item.publicId?null:item.publicId)}>{detail===item.publicId?"Fechar":"Ver"}</Button></td>{canWrite&&<td className="p-3">{item.type!=="reversal"&&!item.reversed&&<Button size="sm" variant="outline" onClick={()=>setReverse({publicId:item.publicId,reason:"",idempotencyKey:newKey()})}>Reverter</Button>}</td>}</tr>{detail===item.publicId&&<tr className="border-t bg-slate-50"><td colSpan={canWrite?10:9} className="p-4 text-sm">Operador: {item.createdBy} · Referência: {item.referenceId??"—"}{item.reversalPublicId&&<> · Reversão: {item.reversalPublicId}</>}</td></tr>}</React.Fragment>)}</tbody></table></div>}
    {movements.data?.items.length?<div className="grid gap-3 md:hidden">{movements.data.items.map(item=><article key={item.publicId} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.productName}</p><p className="text-xs text-slate-500">{item.sku} · {new Date(item.createdAt).toLocaleString("pt-BR")}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{item.reversed?"Revertido":item.type==="reversal"?"Reversão":"Confirmado"}</span></div><p className="mt-3 text-lg font-bold">{item.direction==="in"?"+":"-"}{formatQuantity(item.quantity)}</p><p className="text-sm text-slate-600">{formatQuantity(item.previousBalance)} → {formatQuantity(item.resultingBalance)}</p><p className="mt-2 text-sm">{item.reason}</p><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={()=>setDetail(detail===item.publicId?null:item.publicId)}>{detail===item.publicId?"Fechar":"Detalhes"}</Button>{canWrite&&item.type!=="reversal"&&!item.reversed&&<Button size="sm" variant="outline" onClick={()=>setReverse({publicId:item.publicId,reason:"",idempotencyKey:newKey()})}>Reverter</Button>}</div>{detail===item.publicId&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">Operador: {item.createdBy} · Referência: {item.referenceId??"—"}</p>}</article>)}</div>:null}
    {movements.data&&<Pagination page={page} totalPages={movements.data.totalPages} onPage={setPage}/>}
    <Dialog open={Boolean(form)} onOpenChange={open=>!open&&setForm(null)}><DialogContent className="max-h-[90vh] overflow-y-auto bg-white"><DialogHeader><DialogTitle>Registrar movimentação</DialogTitle></DialogHeader>{form&&<form onSubmit={submit} className="space-y-4"><label className="block text-sm">Produto<select required className="mt-1 w-full rounded-lg border p-2" value={form.productPublicId} onChange={e=>setForm({...form,productPublicId:e.target.value})}><option value="">Selecione</option>{products.data?.items.map(p=><option key={p.publicId} value={p.publicId}>{p.name} — saldo {formatQuantity(p.quantity)}</option>)}</select></label><label className="block text-sm">Operação<select className="mt-1 w-full rounded-lg border p-2" value={form.type} onChange={e=>setForm({...form,type:e.target.value as StockForm["type"]})}><option value="manual_in">Entrada manual</option><option value="manual_out">Saída manual</option><option value="adjustment_in">Ajuste positivo</option><option value="adjustment_out">Ajuste negativo</option></select></label><Field label="Quantidade" value={form.quantity} onChange={quantity=>setForm({...form,quantity})}/><Field label="Motivo" value={form.reason} onChange={reason=>setForm({...form,reason})}/>{selected&&<p className="rounded-lg bg-slate-50 p-3 text-sm">Saldo atual: {formatQuantity(selected.quantity)} · projetado: {projected===null?"—":projected.toLocaleString("pt-BR",{maximumFractionDigits:3})}</p>}{move.error&&<p role="alert" className="text-sm text-red-600">{move.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setForm(null)}>Cancelar</Button><Button type="submit" disabled={move.isPending||!form.productPublicId}>{move.isPending?"Confirmando…":"Confirmar movimentação"}</Button></div></form>}</DialogContent></Dialog>
    <Dialog open={Boolean(reverse)} onOpenChange={open=>!open&&setReverse(null)}><DialogContent className="bg-white"><DialogHeader><DialogTitle>Confirmar reversão</DialogTitle></DialogHeader>{reverse&&<form onSubmit={event=>{event.preventDefault();if(!reverseMutation.isPending)reverseMutation.mutate({movementPublicId:reverse.publicId,reason:reverse.reason,idempotencyKey:reverse.idempotencyKey})}} className="space-y-4"><Field label="Motivo da reversão" value={reverse.reason} onChange={reason=>setReverse({...reverse,reason})}/>{reverseMutation.error&&<p role="alert" className="text-sm text-red-600">{reverseMutation.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setReverse(null)}>Cancelar</Button><Button type="submit" disabled={reverseMutation.isPending||reverse.reason.trim().length<3}>{reverseMutation.isPending?"Revertendo…":"Confirmar reversão"}</Button></div></form>}</DialogContent></Dialog>
  </div>;
}

function Field({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { const id=React.useId(); return <label htmlFor={id} className="text-sm">{label}<Input id={id} className="mt-1" value={value} onChange={e=>onChange(e.target.value)} required={label==="Nome"||label==="SKU"||label==="Quantidade"||label==="Motivo"||label==="Motivo da reversão"}/></label>; }
function Filter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<[string,string]>}) { return <select aria-label={label} className="min-h-10 rounded-lg border px-3" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([key,text])=><option key={key||"all"} value={key}>{text}</option>)}</select>; }
