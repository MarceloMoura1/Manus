import React, { useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
  Volume2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/conversationDateTime";
import { toast } from "sonner";

const CATEGORY_TABS = [
  { id: "all", label: "Todas", icon: Bell },
  { id: "unread", label: "Não lidas", icon: AlertCircle },
  { id: "messages", label: "Mensagens & WhatsApp", icon: MessageSquare },
  { id: "leads", label: "Leads & Vendas", icon: Zap },
  { id: "tickets", label: "Chamados & SLA", icon: LifeBuoy },
  { id: "ai", label: "Rotinas IA", icon: Sparkles },
] as const;

type CategoryTab = (typeof CATEGORY_TABS)[number]["id"];

const typeIcon = (type: string) => {
  switch (type) {
    case "error":
      return <ShieldAlert className="h-5 w-5 text-red-600" />;
    case "warning":
      return <TriangleAlert className="h-5 w-5 text-amber-600" />;
    case "success":
      return <Check className="h-5 w-5 text-emerald-600" />;
    case "system":
      return <Bell className="h-5 w-5 text-blue-600" />;
    default:
      return <Info className="h-5 w-5 text-slate-500" />;
  }
};

const priorityBadge = (type: string) => {
  switch (type) {
    case "error":
      return (
        <span className="rounded-full bg-red-100 text-red-700 font-semibold px-2 py-0.5 text-[10px]">
          Alta Prioridade
        </span>
      );
    case "warning":
      return (
        <span className="rounded-full bg-amber-100 text-amber-800 font-medium px-2 py-0.5 text-[10px]">
          Atenção
        </span>
      );
    case "success":
      return (
        <span className="rounded-full bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 text-[10px]">
          Concluído
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-slate-100 text-slate-600 font-medium px-2 py-0.5 text-[10px]">
          Informativo
        </span>
      );
  }
};

export function NotificationsModernPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  const [page, setPage] = useState(1);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const unreadOnly = activeTab === "unread";
  const apiCategory =
    activeTab === "all" || activeTab === "unread" ? undefined : activeTab;

  const query = trpc.notifications.listV2.useQuery(
    {
      page,
      pageSize: 20,
      unreadOnly,
      category: apiCategory,
    },
    { refetchInterval: 30_000 }
  );

  const preferencesQuery = trpc.notifications.getPreferences.useQuery(
    undefined,
    {
      enabled: preferencesOpen,
    }
  );

  const updatePreferencesMutation =
    trpc.notifications.updatePreferences.useMutation({
      onSuccess: () => {
        toast.success("Preferências de notificação salvas com sucesso!");
        setPreferencesOpen(false);
      },
      onError: () => {
        toast.error("Erro ao salvar preferências.");
      },
    });

  const [prefForm, setPrefForm] = useState({
    notificationsEnabled: true,
    soundEnabled: true,
    soundVolume: 70,
    desktopNotificationsEnabled: true,
    whatsappNotificationsEnabled: true,
    ticketsNotificationsEnabled: true,
    iaNotificationsEnabled: true,
    erpNotificationsEnabled: true,
    trackingNotificationsEnabled: true,
    showMessagePreview: true,
  });

  React.useEffect(() => {
    if (preferencesQuery.data) {
      setPrefForm({
        notificationsEnabled: preferencesQuery.data.notificationsEnabled,
        soundEnabled: preferencesQuery.data.soundEnabled,
        soundVolume: preferencesQuery.data.soundVolume,
        desktopNotificationsEnabled:
          preferencesQuery.data.desktopNotificationsEnabled,
        whatsappNotificationsEnabled:
          preferencesQuery.data.whatsappNotificationsEnabled,
        ticketsNotificationsEnabled:
          preferencesQuery.data.ticketsNotificationsEnabled,
        iaNotificationsEnabled: preferencesQuery.data.iaNotificationsEnabled,
        erpNotificationsEnabled: preferencesQuery.data.erpNotificationsEnabled,
        trackingNotificationsEnabled:
          preferencesQuery.data.trackingNotificationsEnabled,
        showMessagePreview: preferencesQuery.data.showMessagePreview,
      });
    }
  }, [preferencesQuery.data]);

  const refresh = () => void utils.notifications.listV2.invalidate();

  const mark = trpc.notifications.markAsReadV2.useMutation({
    onSuccess: refresh,
  });
  const markAll = trpc.notifications.markAllAsReadV2.useMutation({
    onSuccess: () => {
      toast.success("Todas as notificações marcadas como lidas.");
      refresh();
    },
  });
  const deleteRead = trpc.notifications.deleteReadV2.useMutation({
    onSuccess: () => {
      toast.success("Notificações lidas excluídas.");
      refresh();
    },
    onError: () => {
      toast.error("Não foi possível excluir as notificações.");
    },
  });

  const mutationPending =
    mark.isPending || markAll.isPending || deleteRead.isPending;
  const mutationError = mark.error ?? markAll.error ?? deleteRead.error;

  React.useEffect(() => {
    if (query.data && page > query.data.totalPages) {
      setPage(query.data.totalPages);
    }
  }, [page, query.data]);

  const handleNotificationClick = (item: {
    notificationId: string;
    isRead: boolean;
    actionUrl: string | null;
  }) => {
    if (!item.isRead) {
      mark.mutate({ notificationId: item.notificationId });
    }
    if (item.actionUrl) {
      if (item.actionUrl.startsWith("http")) {
        window.open(item.actionUrl, "_blank");
      } else {
        setLocation(item.actionUrl);
      }
    }
  };

  return (
    <main
      className="mx-auto min-w-0 max-w-5xl space-y-5 pb-12"
      data-testid="notifications-page"
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shadow-xs">
            <Bell className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Central de Notificações
              </h1>
              {query.data && query.data.unreadCount > 0 && (
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-xs">
                  {query.data.unreadCount} nova
                  {query.data.unreadCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Acompanhe alertas em tempo real de mensagens, chamados, vendas e
              rotinas IA.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-slate-700 hover:bg-slate-100"
            onClick={() => setPreferencesOpen(true)}
          >
            <Settings className="mr-1.5 size-3.5 text-slate-500" />
            Configurar Alertas
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-slate-700 hover:bg-slate-100"
            disabled={!query.data?.unreadCount || mutationPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck className="mr-1.5 size-3.5 text-blue-600" />
            Marcar todas lidas
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            disabled={mutationPending}
            onClick={() => deleteRead.mutate()}
            title="Excluir notificações já lidas"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Limpar lidas
          </Button>
        </div>
      </header>

      {mutationError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"
        >
          Não foi possível atualizar as notificações. Tente novamente.
        </p>
      )}

      {/* Category Tabs */}
      <section
        aria-label="Filtros de notificações"
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xs"
      >
        {CATEGORY_TABS.map(tab => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setPage(1);
              }}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                isSelected
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
              {tab.id === "unread" &&
                query.data &&
                query.data.unreadCount > 0 && (
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isSelected
                        ? "bg-white text-blue-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {query.data.unreadCount}
                  </span>
                )}
            </button>
          );
        })}
      </section>

      {/* Notification List Content */}
      {query.isLoading ? (
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-xs"
        >
          <RefreshCw className="mx-auto size-6 animate-spin text-blue-600" />
          <p className="mt-2 text-sm font-medium">Carregando notificações…</p>
        </div>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center"
        >
          <AlertCircle className="mx-auto h-6 w-6 text-red-600" />
          <p className="mt-2 font-semibold text-red-800">
            Não foi possível carregar as notificações.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      ) : !query.data?.items.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Bell className="size-6" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-slate-900">
            {unreadOnly
              ? "Nenhuma notificação não lida"
              : "Nenhuma notificação encontrada"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Novos eventos do WhatsApp, vendas, chamados e rotinas IA serão
            notificados aqui em tempo real.
          </p>
        </div>
      ) : (
        <section
          aria-label="Lista de notificações"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs divide-y divide-slate-100"
        >
          {query.data.items.map(item => (
            <article
              key={item.notificationId}
              onClick={() => handleNotificationClick(item)}
              className={`flex items-start gap-3.5 p-4 transition cursor-pointer hover:bg-slate-50/80 ${
                item.isRead ? "bg-white" : "bg-blue-50/30"
              }`}
            >
              <div className="mt-0.5 shrink-0">{typeIcon(item.type)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    className={`text-sm tracking-tight text-slate-900 ${
                      item.isRead ? "font-medium" : "font-semibold"
                    }`}
                  >
                    {item.title}
                  </h2>
                  {priorityBadge(item.type)}
                  {!item.isRead && (
                    <span
                      className="size-2 rounded-full bg-blue-600"
                      aria-label="Não lida"
                    />
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 line-clamp-2">
                  {item.message}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <time>{formatDateTime(item.createdAt)}</time>
                  {item.actionUrl && (
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800">
                      Abrir detalhes
                      <ExternalLink className="size-3" />
                    </span>
                  )}
                </div>
              </div>

              {!item.isRead && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-xs text-slate-500 hover:text-blue-600"
                  disabled={mutationPending}
                  onClick={e => {
                    e.stopPropagation();
                    mark.mutate({ notificationId: item.notificationId });
                  }}
                >
                  <Check className="mr-1 size-3.5" />
                  Marcar lida
                </Button>
              )}
            </article>
          ))}
        </section>
      )}

      {/* Pagination */}
      {query.data && query.data.totalPages > 1 && (
        <nav
          aria-label="Paginação"
          className="flex items-center justify-between gap-2 pt-2"
        >
          <span className="text-xs text-slate-500">
            Total de {query.data.total} notificações
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(value => value - 1)}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="text-xs font-semibold text-slate-700">
              Página {page} de {query.data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= query.data.totalPages}
              onClick={() => setPage(value => value + 1)}
            >
              Próxima
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </nav>
      )}

      {/* Preferences Dialog */}
      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Settings className="size-4 text-blue-600" />
              Preferências de Notificações
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Personalize como e quando você deseja ser notificado no MegaDesk.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div>
                <p className="font-semibold text-slate-900">
                  Notificações Ativas
                </p>
                <p className="text-xs text-slate-500">
                  Habilita alertas visuais no sistema
                </p>
              </div>
              <Switch
                checked={prefForm.notificationsEnabled}
                onCheckedChange={checked =>
                  setPrefForm(p => ({ ...p, notificationsEnabled: checked }))
                }
              />
            </div>

            <div className="space-y-2 rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">Avisos Sonoros</p>
                  <p className="text-xs text-slate-500">
                    Tocar som ao receber nova mensagem
                  </p>
                </div>
                <Switch
                  checked={prefForm.soundEnabled}
                  onCheckedChange={checked =>
                    setPrefForm(p => ({ ...p, soundEnabled: checked }))
                  }
                />
              </div>

              {prefForm.soundEnabled && (
                <div className="pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                    <span className="flex items-center gap-1">
                      <Volume2 className="size-3.5" /> Volume do som
                    </span>
                    <span className="font-semibold">
                      {prefForm.soundVolume}%
                    </span>
                  </div>
                  <Slider
                    value={[prefForm.soundVolume]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([val]) =>
                      setPrefForm(p => ({ ...p, soundVolume: val }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Canais Notificados
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-700">Mensagens WhatsApp</span>
                  <Switch
                    checked={prefForm.whatsappNotificationsEnabled}
                    onCheckedChange={checked =>
                      setPrefForm(p => ({
                        ...p,
                        whatsappNotificationsEnabled: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-700">Chamados & Tickets</span>
                  <Switch
                    checked={prefForm.ticketsNotificationsEnabled}
                    onCheckedChange={checked =>
                      setPrefForm(p => ({
                        ...p,
                        ticketsNotificationsEnabled: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-700">Rotinas do Assistente IA</span>
                  <Switch
                    checked={prefForm.iaNotificationsEnabled}
                    onCheckedChange={checked =>
                      setPrefForm(p => ({
                        ...p,
                        iaNotificationsEnabled: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-700">Vendas & ERP</span>
                  <Switch
                    checked={prefForm.erpNotificationsEnabled}
                    onCheckedChange={checked =>
                      setPrefForm(p => ({
                        ...p,
                        erpNotificationsEnabled: checked,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreferencesOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={updatePreferencesMutation.isPending}
              onClick={() => updatePreferencesMutation.mutate(prefForm)}
            >
              {updatePreferencesMutation.isPending ? "Salvando…" : "Salvar preferências"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
