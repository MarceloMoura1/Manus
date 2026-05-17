import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  MessageCircle,
  X,
  Clock,
  User,
  Search,
  Eye,
  Send,
  Phone,
  Building2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

interface ConversationCard {
  id: string;
  customerName: string;
  customerPhone: string;
  companyName?: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  status: "open" | "pending" | "closed";
  assignedUserId: string | null;
  assignedUserName?: string;
}

export function ConversasPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "mine" | "specific">("all");
  const [filterUser, setFilterUser] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationCard | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignToUser, setAssignToUser] = useState<string | null>(null);

  // Get clientId and userId from session
  const getSessionData = () => {
    try {
      const session = JSON.parse(
        localStorage.getItem("megadesk_session_v1") || "{}"
      );
      return { clientId: session.clientId || "", userId: session.userId || "" };
    } catch {
      return { clientId: "", userId: "" };
    }
  };

  const { clientId, userId } = getSessionData();

  // Queries
  const { data: conversations = [], isLoading: conversationsLoading } =
    trpc.conversations.list.useQuery({
      clientId,
    });

  const { data: users = [] } = trpc.users.list.useQuery({
    clientId,
  });

  // Mutations
  const closeConversationMutation = trpc.conversations.close.useMutation();
  const assignConversationMutation = trpc.conversations.assign.useMutation();

  // Aplicar filtro de visualização
  const conversationsFiltered = useMemo(() => {
    let filtered = conversations as ConversationCard[];

    if (viewMode === "mine") {
      filtered = filtered.filter((c) => c.assignedUserId === userId);
    } else if (viewMode === "specific" && filterUser) {
      filtered = filtered.filter((c) => c.assignedUserId === filterUser);
    }

    return filtered;
  }, [conversations, viewMode, filterUser, userId]);

  // Filtrar por termo de busca
  const filteredConversations = useMemo(() => {
    let filtered = conversationsFiltered;

    if (searchTerm) {
      filtered = filtered.filter(
        (c) =>
          c.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.customerPhone.includes(searchTerm) ||
          c.companyName?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  }, [conversationsFiltered, searchTerm]);

  // Agrupar conversas por status
  const conversationsByStatus = useMemo(() => {
    return {
      open: filteredConversations.filter((c) => c.status === "open"),
      pending: filteredConversations.filter((c) => c.status === "pending"),
      closed: filteredConversations.filter((c) => c.status === "closed"),
    };
  }, [filteredConversations]);

  const handleCloseConversation = async () => {
    if (!selectedConversation) return;

    try {
      await closeConversationMutation.mutateAsync({
        clientId,
        conversationId: selectedConversation.id,
      });
      setShowCloseDialog(false);
      setSelectedConversation(null);
    } catch (error) {
      console.error("Erro ao encerrar conversa:", error);
    }
  };

  const handleAssignConversation = async () => {
    if (!selectedConversation || !assignToUser) return;

    try {
      await assignConversationMutation.mutateAsync({
        clientId,
        conversationId: selectedConversation.id,
        userId: assignToUser,
      });
      setShowAssignDialog(false);
      setSelectedConversation(null);
    } catch (error) {
      console.error("Erro ao atribuir conversa:", error);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleDateString("pt-BR", { month: "2-digit", day: "2-digit" });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "closed":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "open":
        return "Aberta";
      case "pending":
        return "Pendente";
      case "closed":
        return "Encerrada";
      default:
        return status;
    }
  };

  const ConversationCard = ({ conv }: { conv: ConversationCard }) => (
    <Card
      className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
      onClick={() => setSelectedConversation(conv)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-gray-900">{conv.customerName}</h3>
            {conv.unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {conv.unreadCount}
              </Badge>
            )}
          </div>

          <div className="space-y-1 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Phone size={14} />
              <span>{conv.customerPhone}</span>
            </div>
            {conv.companyName && (
              <div className="flex items-center gap-2">
                <Building2 size={14} />
                <span>{conv.companyName}</span>
              </div>
            )}
          </div>

          <p className="text-sm text-gray-700 mt-2 line-clamp-2">
            {conv.lastMessage}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Badge className={getStatusColor(conv.status)}>
            {getStatusLabel(conv.status)}
          </Badge>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock size={12} />
            {formatDate(conv.lastMessageAt)}
          </div>
        </div>
      </div>

      {conv.assignedUserName && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2 text-xs text-gray-600">
          <User size={12} />
          <span>{conv.assignedUserName}</span>
        </div>
      )}
    </Card>
  );

  const ConversationList = ({
    conversations,
  }: {
    conversations: ConversationCard[];
  }) => {
    if (conversationsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      );
    }

    if (conversations.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <MessageCircle size={48} className="mb-4 opacity-50" />
          <p className="text-lg font-medium">Nenhuma conversa encontrada</p>
          <p className="text-sm">Tente ajustar os filtros de busca</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {conversations.map((conv) => (
          <ConversationCard key={conv.id} conv={conv} />
        ))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">Conversas</h1>

          {/* Filtros */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Busca */}
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-3 text-gray-400"
              />
              <Input
                placeholder="Buscar por nome, telefone ou empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Modo de visualização */}
            <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
              <SelectTrigger>
                <Eye size={16} className="mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as conversas</SelectItem>
                <SelectItem value="mine">Minhas conversas</SelectItem>
                <SelectItem value="specific">Usuário específico</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro de usuário (apenas se "specific" estiver selecionado) */}
            {viewMode === "specific" && (
              <Select value={filterUser || ""} onValueChange={setFilterUser}>
                <SelectTrigger>
                  <User size={16} className="mr-2" />
                  <SelectValue placeholder="Selecionar usuário" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user: any) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          <Tabs defaultValue="open" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="open" className="flex items-center gap-2">
                <MessageCircle size={16} />
                <span>Abertas</span>
                {conversationsByStatus.open.length > 0 && (
                  <Badge variant="secondary">
                    {conversationsByStatus.open.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex items-center gap-2">
                <Clock size={16} />
                <span>Pendentes</span>
                {conversationsByStatus.pending.length > 0 && (
                  <Badge variant="secondary">
                    {conversationsByStatus.pending.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="closed" className="flex items-center gap-2">
                <X size={16} />
                <span>Encerradas</span>
                {conversationsByStatus.closed.length > 0 && (
                  <Badge variant="secondary">
                    {conversationsByStatus.closed.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="open">
              <ConversationList conversations={conversationsByStatus.open} />
            </TabsContent>
            <TabsContent value="pending">
              <ConversationList conversations={conversationsByStatus.pending} />
            </TabsContent>
            <TabsContent value="closed">
              <ConversationList conversations={conversationsByStatus.closed} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Modal de Detalhes */}
      {selectedConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white w-full md:w-96 h-full md:h-auto md:rounded-lg md:shadow-lg flex flex-col">
            {/* Header da Modal */}
            <div className="border-b border-gray-200 p-4 flex items-start justify-between">
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900">
                  {selectedConversation.customerName}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedConversation.customerPhone}
                </p>
                {selectedConversation.companyName && (
                  <p className="text-sm text-gray-600">
                    {selectedConversation.companyName}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedConversation(null)}
              >
                <X size={20} />
              </Button>
            </div>

            {/* Conteúdo da Modal */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Status */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Status
                </label>
                <Badge className={`mt-2 ${getStatusColor(selectedConversation.status)}`}>
                  {getStatusLabel(selectedConversation.status)}
                </Badge>
              </div>

              {/* Mensagem */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Última mensagem
                </label>
                <p className="text-sm text-gray-600 mt-2">
                  {selectedConversation.lastMessage}
                </p>
              </div>

              {/* Atribuição */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Atribuído a
                </label>
                <p className="text-sm text-gray-600 mt-2">
                  {selectedConversation.assignedUserName || "Não atribuído"}
                </p>
              </div>
            </div>

            {/* Ações */}
            <div className="border-t border-gray-200 p-4 space-y-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setShowAssignDialog(true)}
              >
                <User size={16} className="mr-2" />
                Reatribuir
              </Button>
              <Button
                className="w-full"
                variant={
                  selectedConversation.status === "closed"
                    ? "default"
                    : "destructive"
                }
                onClick={() => setShowCloseDialog(true)}
              >
                {selectedConversation.status === "closed"
                  ? "Reabrir conversa"
                  : "Encerrar conversa"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog de Encerramento */}
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {selectedConversation?.status === "closed"
              ? "Reabrir conversa?"
              : "Encerrar conversa?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {selectedConversation?.status === "closed"
              ? "Esta ação reabrirá a conversa com o cliente."
              : "Esta ação encerrará a conversa com o cliente. Você poderá reabri-la depois se necessário."}
          </AlertDialogDescription>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCloseConversation}
              className={
                selectedConversation?.status === "closed"
                  ? ""
                  : "bg-red-600 hover:bg-red-700"
              }
            >
              {closeConversationMutation.isPending ? (
                <Spinner className="mr-2" />
              ) : null}
              {selectedConversation?.status === "closed"
                ? "Reabrir"
                : "Encerrar"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de Reatribuição */}
      <AlertDialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Reatribuir conversa</AlertDialogTitle>
          <AlertDialogDescription>
            Selecione um usuário para atribuir esta conversa.
          </AlertDialogDescription>
          <Select value={assignToUser || ""} onValueChange={setAssignToUser}>
            <SelectTrigger>
              <SelectValue placeholder="Selecionar usuário" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user: any) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAssignConversation}>
              {assignConversationMutation.isPending ? (
                <Spinner className="mr-2" />
              ) : null}
              Atribuir
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
