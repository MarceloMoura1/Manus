import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, Trash2, CheckCircle2, AlertCircle, Info, AlertTriangle, Zap } from "lucide-react";

type NotificationType = "info" | "success" | "warning" | "error" | "system";

interface Notification {
  notificationId: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  actionUrl?: string | null;
  createdAt: Date;
  readAt?: Date | null;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem("megadesk_session_v1") || "{}");
      setClientId(session?.clientId || "");
    } catch (error) {
      console.error("Erro ao recuperar clientId:", error);
    }
  }, []);

  // Fetch notifications
  const { data: notificationsData, isLoading, refetch } = trpc.notifications.getNotifications.useQuery(
    {
      clientId,
      unreadOnly: activeTab === "unread",
      limit: 100,
    },
    { enabled: !!clientId && !!user, refetchInterval: 5000 }
  );

  // Mutations
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => refetch(),
  });

  const deleteNotificationMutation = trpc.notifications.deleteNotification.useMutation({
    onSuccess: () => refetch(),
  });

  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => refetch(),
  });

  const createNotificationMutation = trpc.notifications.createNotification.useMutation({
    onSuccess: () => refetch(),
  });

  useEffect(() => {
    if (notificationsData?.notifications) {
      setNotifications(notificationsData.notifications);
    }
  }, [notificationsData]);

  const handleMarkAsRead = (notificationId: string) => {
    markAsReadMutation.mutate({ clientId, notificationId });
  };

  const handleDelete = (notificationId: string) => {
    deleteNotificationMutation.mutate({ clientId, notificationId });
  };

  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate({ clientId });
  };

  const handleCreateTestNotification = () => {
    if (!clientId) {
      console.error("ClientId não disponível");
      return;
    }
    
    const types: NotificationType[] = ["info", "success", "warning", "error", "system"];
    const randomType = types[Math.floor(Math.random() * types.length)];
    const messages = [
      "Nova mensagem recebida no WhatsApp",
      "Chamado #123 foi atualizado",
      "Sua quota de API foi atingida",
      "Erro ao processar integração",
      "Sistema atualizado com sucesso",
    ];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    createNotificationMutation.mutate({
      clientId,
      title: "Notificação de Teste",
      message: randomMessage,
      type: randomType,
    });
  };

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "system":
        return <Zap className="w-5 h-5 text-blue-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getNotificationBgColor = (type: NotificationType) => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200";
      case "warning":
        return "bg-yellow-50 border-yellow-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "system":
        return "bg-blue-50 border-blue-200";
      default:
        return "bg-slate-50 border-slate-200";
    }
  };

  const unreadCount = notificationsData?.unreadCount || 0;
  const filteredNotifications = activeTab === "unread" ? notifications.filter(n => !n.isRead) : notifications;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Bell className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">Notificações</h1>
                <p className="text-slate-600 mt-1">Gerencie suas notificações e atualizações</p>
              </div>
            </div>
            {unreadCount > 0 && (
              <Badge className="bg-red-500 text-white text-lg px-3 py-1">
                {unreadCount} não lida{unreadCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0 || markAllAsReadMutation.isPending}
              variant="outline"
              className="gap-2"
            >
              <Check className="w-4 h-4" />
              Marcar todas como lidas
            </Button>
            <Button
              onClick={handleCreateTestNotification}
              disabled={createNotificationMutation.isPending}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Bell className="w-4 h-4" />
              Criar Notificação de Teste
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="grid w-full grid-cols-2 bg-white border border-slate-200">
            <TabsTrigger value="all">Todas ({notificationsData?.total || 0})</TabsTrigger>
            <TabsTrigger value="unread">Não lidas ({unreadCount})</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="p-4 bg-white animate-pulse">
                    <div className="h-4 bg-slate-200 rounded w-1/4 mb-3"></div>
                    <div className="h-3 bg-slate-100 rounded w-3/4"></div>
                  </Card>
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <Card className="p-12 text-center bg-white border-slate-200">
                <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  {activeTab === "unread" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}
                </h3>
                <p className="text-slate-600">
                  {activeTab === "unread"
                    ? "Você está em dia com todas as suas notificações!"
                    : "Você não tem notificações no momento"}
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredNotifications.map((notification) => (
                  <Card
                    key={notification.notificationId}
                    className={`p-4 border-l-4 transition-all hover:shadow-md ${
                      getNotificationBgColor(notification.type)
                    } ${!notification.isRead ? "border-l-blue-500 bg-opacity-100" : "border-l-slate-300 opacity-75"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        <div className="mt-1">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-slate-900">{notification.title}</h3>
                            {!notification.isRead && (
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            )}
                          </div>
                          <p className="text-slate-700 text-sm mb-2">{notification.message}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(notification.createdAt).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        {!notification.isRead && (
                          <Button
                            onClick={() => handleMarkAsRead(notification.notificationId)}
                            disabled={markAsReadMutation.isPending}
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            title="Marcar como lida"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          onClick={() => handleDelete(notification.notificationId)}
                          disabled={deleteNotificationMutation.isPending}
                          size="sm"
                          variant="outline"
                          className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Deletar notificação"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
