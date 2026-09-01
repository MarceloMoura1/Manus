import React from "react";
import { AlertCircle, Bell, Check, ChevronLeft, ChevronRight, Info, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const categories = [["all", "Todas"], ["info", "Informações"], ["success", "Concluídas"], ["warning", "Atenção"], ["error", "Falhas"], ["system", "Sistema"]] as const;
type Category = (typeof categories)[number][0];
const typeIcon = (type: string) => type === "error" ? <ShieldAlert className="h-5 w-5 text-red-600"/> : type === "warning" ? <TriangleAlert className="h-5 w-5 text-amber-600"/> : type === "system" ? <Bell className="h-5 w-5 text-blue-600"/> : <Info className="h-5 w-5 text-slate-500"/>;
const priority = (type: string) => type === "error" ? "Alta" : type === "warning" ? "Média" : "Normal";

export function NotificationsModernPage() {
  const utils = trpc.useUtils();
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [category, setCategory] = React.useState<Category>("all");
  const [page, setPage] = React.useState(1);
  const query = trpc.notifications.listV2.useQuery({ page, pageSize: 20, unreadOnly, category: category === "all" ? undefined : category }, { refetchInterval: 30_000 });
  const refresh = () => void utils.notifications.listV2.invalidate();
  const mark = trpc.notifications.markAsReadV2.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllAsReadV2.useMutation({ onSuccess: refresh });
  const mutationPending = mark.isPending || markAll.isPending;
  const mutationError = mark.error ?? markAll.error;

  React.useEffect(() => {
    if (query.data && page > query.data.totalPages) setPage(query.data.totalPages);
  }, [page, query.data]);

  return <main className="mx-auto min-w-0 max-w-5xl space-y-5" data-testid="notifications-page">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5"><Bell className="h-5 w-5 text-blue-600"/></span><h1 className="text-2xl font-bold text-slate-900">Notificações</h1></div>
      <div className="flex items-center gap-2">{query.data && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{query.data.unreadCount} não lida{query.data.unreadCount === 1 ? "" : "s"}</span>}<Button variant="outline" disabled={!query.data?.unreadCount || mutationPending} onClick={() => markAll.mutate()}><Check className="mr-2 h-4 w-4"/>Marcar todas como lidas</Button></div>
    </header>
    {mutationError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">Não foi possível atualizar as notificações. Tente novamente.</p>}
    <section aria-label="Filtros de notificações" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <Button size="sm" variant={!unreadOnly ? "default" : "outline"} onClick={() => { setUnreadOnly(false); setPage(1); }}>Todas</Button>
      <Button size="sm" variant={unreadOnly ? "default" : "outline"} onClick={() => { setUnreadOnly(true); setPage(1); }}>Não lidas</Button>
      <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">Categoria<select className="min-h-9 rounded-lg border border-slate-200 bg-white px-2" value={category} onChange={event => { setCategory(event.target.value as Category); setPage(1); }}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </section>
    {query.isLoading ? <div role="status" className="rounded-2xl border bg-white p-8 text-center text-slate-600">Carregando notificações…</div>
      : query.error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center"><AlertCircle className="mx-auto h-6 w-6 text-red-600"/><p className="mt-2 font-semibold text-red-800">Não foi possível carregar as notificações.</p><Button className="mt-4" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Tentar novamente</Button></div>
      : !query.data?.items.length ? <div className="rounded-2xl border bg-white p-10 text-center"><Bell className="mx-auto h-8 w-8 text-slate-300"/><h2 className="mt-3 font-semibold text-slate-900">{unreadOnly ? "Nenhuma notificação não lida" : "Nenhuma notificação encontrada"}</h2><p className="mt-1 text-sm text-slate-500">Os eventos internos relevantes aparecerão aqui.</p></div>
      : <section aria-label="Lista de notificações" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{query.data.items.map(item => <article key={item.notificationId} className={`flex gap-3 border-b border-slate-100 p-4 last:border-b-0 ${item.isRead ? "bg-white" : "bg-blue-50/40"}`}><div className="mt-0.5">{typeIcon(item.type)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-900">{item.title}</h2><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">Prioridade {priority(item.type)}</span>{!item.isRead && <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Não lida"/>}</div><p className="mt-1 text-sm text-slate-600">{item.message}</p><p className="mt-2 text-xs text-slate-400">{new Date(item.createdAt).toLocaleString("pt-BR")}</p>{item.actionUrl && <a href={item.actionUrl} className="mt-2 inline-flex text-sm font-semibold text-blue-700 hover:underline">Abrir no MegaDesk</a>}</div>{!item.isRead && <Button size="sm" variant="ghost" disabled={mutationPending} onClick={() => mark.mutate({ notificationId: item.notificationId })}>Marcar como lida</Button>}</article>)}</section>}
    {query.data && query.data.totalPages > 1 && <nav aria-label="Paginação" className="flex items-center justify-end gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="mr-1 h-4 w-4"/>Anterior</Button><span className="text-sm text-slate-600">Página {page} de {query.data.totalPages}</span><Button variant="outline" size="sm" disabled={page >= query.data.totalPages} onClick={() => setPage(value => value + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4"/></Button></nav>}
  </main>;
}
