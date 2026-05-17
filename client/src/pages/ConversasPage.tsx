import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MessageCircle, X, Clock, User, Search } from "lucide-react";
import { useAuth } from "@/src/_core/hooks/useAuth";
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
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterUser, setFilterUser] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationCard | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignToUser, setAssignToUser] = useState<string | null>(null);

  // Queries
  const { data: conversations = [], isLoading: conversationsLoading } = trpc.conversations.list.useQuery({
    clientId: user?.clientId || "",
  });

  const { data: users = [] } = trpc.users.list.useQuery({
    clientId: user?.clientId || "",
  });

  // Mutations
  const closeConversationMutation = trpc.conversations.close.useMutation();
  const assignConversationMutation = trpc.conversations.assign.useMutation();

  // Filtrar e organizar conversas
  const filteredConversations = useMemo(() => {
    let filtered = conversations as ConversationCard[];

    // Filtrar por termo de busca
    if (searchTerm) {
      filtered = filtered.filter(
        (c) =>
          c.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.customerPhone.includes(searchTerm) ||
          c.companyName?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filtrar por usuário
    if (filterUser === "unassigned") {
      filtered = filtered.filter((c) => !c.assignedUserId);
    } else if (filterUser && filterUser !== "all") {
      filtered = filtered.filter((c) => c.assignedUserId === filterUser);
    }

    return filtered;
  }, [conversations, searchTerm, filterUser]);

  // Agrupar por usuário
  const conversationsByUser = useMemo(() => {
    const grouped: Record<string, ConversationCard[]> = {};

    filteredConversations.forEach((conv) => {
      const userId = conv.assignedUserId || "unassigned";
      if (!grouped[userId]) {
        grouped[userId] = [];
      }
      grouped[userId].push(conv);
    });

    return grouped;
  }, [filteredConversations]);

  // Handlers
  const handleCloseConversation = async () => {
    if (!selectedConversation) return;

    try {
      await closeConversationMutation.mutateAsync({
        conversationId: selectedConversation.id,
        clientId: user?.clientId || "",
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
        conversationId: selectedConversation.id,
        userId: assignToUser,
        clientId: user?.clientId || "",
      });
      setShowAssignDialog(false);
      setSelectedConversation(null);
      setAssignToUser(null);
    } catch (error) {
      console.error("Erro ao atribuir conversa:", error);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleDateString("pt-BR", { month: "2-digit", day: "2-digit" });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      open: "default",
      pending: "secondary",
      closed: "outline",
    };
    return variants[status] || "default";
  };

  if (conversationsLoading) {
    return <div className="p-6 text-center">Carregando conversas...</div>;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border p-6 space-y-4">
        <h1 className="text-3xl font-bold">Conversas</h1>

        {/* Filtros */}
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <Select value={filterUser || "all"} onValueChange={(v) => setFilterUser(v === "all" ? null : v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Filtrar por atendente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as conversas</SelectItem>
              <SelectItem value="unassigned">Não atribuídas</SelectItem>
              {users.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-6">
        {filteredConversations.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <Tabs defaultValue="open" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="open">
                Abertas ({filteredConversations.filter((c) => c.status === "open").length})
              </TabsTrigger>
              <TabsTrigger value="pending">
                Pendentes ({filteredConversations.filter((c) => c.status === "pending").length})
              </TabsTrigger>
              <TabsTrigger value="closed">
                Encerradas ({filteredConversations.filter((c) => c.status === "closed").length})
              </TabsTrigger>
            </TabsList>

            {["open", "pending", "closed"].map((status) => (
              <TabsContent key={status} value={status} className="space-y-4">
                {filteredConversations
                  .filter((c) => c.status === status)
                  .map((conversation) => (
                    <Card
                      key={conversation.id}
                      className="p-4 cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => setSelectedConversation(conversation)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold truncate">{conversation.customerName}</h3>
                            {conversation.unreadCount > 0 && (
                              <Badge variant="destructive">{conversation.unreadCount}</Badge>
                            )}
                          </div>

                          <p className="text-sm text-muted-foreground truncate mb-2">
                            {conversation.companyName || conversation.customerPhone}
                          </p>

                          <p className="text-sm text-foreground truncate mb-2">
                            {conversation.lastMessage || "Sem mensagens"}
                          </p>

                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(conversation.lastMessageAt)}
                            </div>

                            {conversation.assignedUserName && (
                              <div className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                {conversation.assignedUserName}
                              </div>
                            )}
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedConversation(conversation);
                          }}
                        >
                          Ver
                        </Button>
                      </div>
                    </Card>
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {/* Modal de detalhes */}
      {selectedConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selectedConversation.customerName}</h2>
                  <p className="text-sm text-muted-foreground">{selectedConversation.customerPhone}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedConversation(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Empresa:</p>
                <p className="text-sm">{selectedConversation.companyName || "N/A"}</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Status:</p>
                <Badge variant={getStatusBadge(selectedConversation.status)}>
                  {selectedConversation.status}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Atribuído a:</p>
                <p className="text-sm">{selectedConversation.assignedUserName || "Não atribuído"}</p>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowAssignDialog(true);
                  }}
                >
                  Reatribuir
                </Button>

                {selectedConversation.status !== "closed" && (
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      setShowCloseDialog(true);
                    }}
                  >
                    Encerrar
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Dialog de encerramento */}
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Encerrar conversa?</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja encerrar esta conversa com {selectedConversation?.customerName}?
          </AlertDialogDescription>
          <div className="flex gap-2">
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleCloseConversation} className="bg-destructive text-destructive-foreground">
              Sim, encerrar
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de reatribuição */}
      <AlertDialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Reatribuir conversa</AlertDialogTitle>
          <AlertDialogDescription>
            Selecione o atendente para reatribuir esta conversa.
          </AlertDialogDescription>

          <Select value={assignToUser || ""} onValueChange={setAssignToUser}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um atendente" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAssignConversation}>
              Reatribuir
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
