import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Users,
  SlidersHorizontal,
  Smartphone,
  Cpu,
  Plus,
  CheckCircle2,
  RefreshCw,
  QrCode,
  Bot,
  ClipboardList,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AITokenUsagePage } from "@/pages/AITokenUsagePage";
import { cn } from "@/lib/utils";

interface AdminUnifiedHubProps {
  tenantKey: string;
  userName: string;
}

export function AdminUnifiedHub({ tenantKey, userName }: AdminUnifiedHubProps) {
  const [subTab, setSubTab] = useState<"equipe" | "fluxos" | "whatsapp" | "ia_audit">("equipe");

  // ──────────────────────────────────────────────────────────────────────────
  // SUB-ABA 1: EQUIPE & OPERADORES
  // ──────────────────────────────────────────────────────────────────────────
  const teamUsersQuery = trpc.megadeskSettings.listTeamUsers.useQuery(
    { clientId: tenantKey, userRole: "admin" },
    { staleTime: 10_000 }
  );

  const addTeamUserMutation = trpc.megadeskSettings.addTeamUser.useMutation({
    onSuccess: () => {
      void teamUsersQuery.refetch();
      setIsAddUserOpen(false);
      setNewUserForm({ name: "", email: "", password: "", role: "agent" });
    },
  });

  const updateTeamUserMutation = trpc.megadeskSettings.updateTeamUser.useMutation({
    onSuccess: () => {
      void teamUsersQuery.refetch();
    },
  });

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState<{
    name: string;
    email: string;
    password: string;
    role: "admin" | "manager" | "agent" | "viewer";
  }>({
    name: "",
    email: "",
    password: "",
    role: "agent",
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.email || !newUserForm.password) return;
    try {
      await addTeamUserMutation.mutateAsync({
        clientId: tenantKey,
        userRole: "admin",
        name: newUserForm.name.trim(),
        email: newUserForm.email.trim(),
        password: newUserForm.password,
        role: newUserForm.role,
      });
    } catch (err) {
      console.error("[AdminUnifiedHub] Falha ao criar operador:", err);
    }
  };

  const handleToggleUserActive = async (user: any) => {
    try {
      await updateTeamUserMutation.mutateAsync({
        clientId: tenantKey,
        userRole: "admin",
        targetUserId: user.userId,
        status: user.status === "active" ? "blocked" : "active",
      });
    } catch (err) {
      console.error("[AdminUnifiedHub] Falha ao alterar status:", err);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: "Administrador",
    manager: "Gerente",
    agent: "Atendente",
    viewer: "Visualizador",
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SUB-ABA 2: ATENDIMENTO & FLUXOS (STATUS DE CHAMADOS + BOT SCRIPTS)
  // ──────────────────────────────────────────────────────────────────────────
  const ticketStatusesQuery = trpc.megadeskSettings.listTicketStatuses.useQuery(
    { clientId: tenantKey, userRole: "admin" },
    { staleTime: 30_000 }
  );

  const botScriptsQuery = trpc.botScripts.list.useQuery(
    { clientId: tenantKey },
    { staleTime: 15_000 }
  );

  const botWorkspaceQuery = trpc.bot.getClientWorkspaceUrl.useQuery(
    { clientId: tenantKey, userRole: "admin" },
    { staleTime: 60_000 }
  );

  const activateBotScriptMut = trpc.botScripts.activate.useMutation({
    onSuccess: () => {
      void botScriptsQuery.refetch();
    },
  });

  const deactivateBotScriptMut = trpc.botScripts.deactivate.useMutation({
    onSuccess: () => {
      void botScriptsQuery.refetch();
    },
  });

  const [isAddScriptOpen, setIsAddScriptOpen] = useState(false);
  const [newScriptForm, setNewScriptForm] = useState({
    name: "",
    description: "",
    systemPrompt: "Você é um assistente virtual prestativo que atende clientes com cordialidade.",
    initialMessage: "Olá! Como posso ajudar você hoje?",
  });

  const createBotScriptMut = trpc.botScripts.create.useMutation({
    onSuccess: () => {
      void botScriptsQuery.refetch();
      setIsAddScriptOpen(false);
      setNewScriptForm({
        name: "",
        description: "",
        systemPrompt: "Você é um assistente virtual prestativo que atende clientes com cordialidade.",
        initialMessage: "Olá! Como posso ajudar você hoje?",
      });
    },
  });

  const handleCreateScript = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScriptForm.name || !newScriptForm.systemPrompt) return;
    try {
      await createBotScriptMut.mutateAsync({
        clientId: tenantKey,
        name: newScriptForm.name.trim(),
        description: newScriptForm.description.trim(),
        systemPrompt: newScriptForm.systemPrompt.trim(),
        initialMessage: newScriptForm.initialMessage.trim(),
      });
    } catch (err) {
      console.error("[AdminUnifiedHub] Falha ao criar roteiro:", err);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SUB-ABA 3: CONEXÃO WHATSAPP (100% WHITE-LABEL)
  // ──────────────────────────────────────────────────────────────────────────
  const whatsappStatusQuery = trpc.evolution.getStatus.useQuery(
    { clientId: tenantKey },
    { refetchInterval: 5000 }
  );

  const [qrCodeData, setQrCodeData] = useState<{ base64: string } | null>(null);

  const connectWhatsAppMutation = trpc.evolution.connect.useMutation({
    onSuccess: (data: any) => {
      if (data?.qrCode) {
        setQrCodeData({ base64: data.qrCode });
      }
      void whatsappStatusQuery.refetch();
    },
  });

  const disconnectWhatsAppMutation = trpc.evolution.disconnect.useMutation({
    onSuccess: () => {
      setQrCodeData(null);
      void whatsappStatusQuery.refetch();
    },
  });

  const isWhatsAppConnected =
    whatsappStatusQuery.data?.status === "connected" ||
    (whatsappStatusQuery.data as any)?.status === "open";

  const connectedPhone = whatsappStatusQuery.data?.phoneNumber || null;

  return (
    <div className="space-y-6">
      {/* Navegação por Sub-Abas do Hub Administrativo */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/60 border border-border w-fit max-w-full overflow-x-auto no-scrollbar">
        {[
          { id: "equipe" as const, label: "Equipe & Operadores", icon: Users },
          { id: "fluxos" as const, label: "Atendimento & Fluxos", icon: SlidersHorizontal },
          { id: "whatsapp" as const, label: "Conexão WhatsApp", icon: Smartphone },
          { id: "ia_audit" as const, label: "Consumo & Auditoria de IA", icon: Cpu },
        ].map((tab) => {
          const isActive = subTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap",
                isActive
                  ? "bg-card text-blue-600 dark:text-blue-400 shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo da Sub-Aba 1: Equipe & Operadores */}
      {subTab === "equipe" && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-border shadow-xs">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-500" />
                Equipe & Operadores
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controle de acessos, atendentes e membros da sua empresa.
              </p>
            </div>

            <Button
              onClick={() => setIsAddUserOpen(true)}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Operador</span>
            </Button>
          </div>

          {/* Lista de Membros */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                Operadores Cadastrados ({teamUsersQuery.data?.length ?? 0})
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => teamUsersQuery.refetch()}
                className="h-7 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <RefreshCw className={cn("w-3 h-3 mr-1", teamUsersQuery.isFetching && "animate-spin")} />
                Atualizar
              </Button>
            </div>

            <div className="divide-y divide-border">
              {teamUsersQuery.isLoading ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-500" />
                  Carregando operadores...
                </div>
              ) : (teamUsersQuery.data?.length ?? 0) === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Nenhum usuário adicional cadastrado. Cadastre atendentes para sua equipe.
                </div>
              ) : (
                teamUsersQuery.data?.map((user: any) => {
                  const isActive = user.status === "active";
                  return (
                    <div key={user.userId} className="p-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors">
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center font-bold text-xs uppercase flex-shrink-0">
                          {user.name ? user.name.slice(0, 2) : "OP"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">{user.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">{user.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <Badge variant="outline" className="text-[10px] uppercase font-bold py-0.5">
                          {roleLabels[user.role] || user.role}
                        </Badge>

                        <button
                          type="button"
                          onClick={() => handleToggleUserActive(user)}
                          disabled={updateTeamUserMutation.isPending}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer",
                            isActive
                              ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
                          )}
                          title={isActive ? "Desativar operador" : "Ativar operador"}
                        >
                          {isActive ? "Ativo" : "Bloqueado"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Modal de Criação de Operador */}
          <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
            <DialogContent className="sm:max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Cadastrar Novo Operador
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Adicione um novo membro à equipe com acesso à plataforma.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateUser} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Nome Completo</Label>
                  <Input
                    required
                    value={newUserForm.name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                    placeholder="Ex: Carlos Silva"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">E-mail de Acesso</Label>
                  <Input
                    type="email"
                    required
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    placeholder="carlos@empresa.com.br"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Senha Provisória</Label>
                  <Input
                    type="password"
                    required
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    placeholder="••••••••"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Perfil de Acesso</Label>
                  <Select
                    value={newUserForm.role}
                    onValueChange={(val: "admin" | "manager" | "agent" | "viewer") =>
                      setNewUserForm({ ...newUserForm, role: val })
                    }
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Selecione o perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Atendente (Conversas & Chamados)</SelectItem>
                      <SelectItem value="manager">Gerente / Supervisor</SelectItem>
                      <SelectItem value="admin">Administrador Completo</SelectItem>
                      <SelectItem value="viewer">Visualizador (Somente Leitura)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <DialogFooter className="pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddUserOpen(false)}
                    className="text-xs cursor-pointer"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={addTeamUserMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    {addTeamUserMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                    Criar Operador
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Conteúdo da Sub-Aba 2: Atendimento & Fluxos */}
      {subTab === "fluxos" && (
        <div className="space-y-6 animate-fade-in">
          {/* Card 1: Status de Chamados */}
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Ciclo de Vida & Status de Chamados</h3>
                  <p className="text-[11px] text-muted-foreground">Status cadastrados para o fluxo de atendimento técnico.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(ticketStatusesQuery.data || [
                { id: "1", name: "Aberto", color: "#3B82F6", is_initial: true },
                { id: "2", name: "Em Andamento", color: "#F59E0B" },
                { id: "3", name: "Aguardando Cliente", color: "#8B5CF6" },
                { id: "4", name: "Fechado / Resolvido", color: "#10B981", is_final: true },
              ]).map((st: any) => (
                <div key={st.id} className="p-3.5 rounded-xl border border-border bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: st.color || "#3B82F6" }} />
                    <span className="text-xs font-bold text-foreground">{st.name}</span>
                  </div>
                  {st.is_initial && <Badge variant="secondary" className="text-[9px]">Inicial</Badge>}
                  {st.is_final && <Badge variant="secondary" className="text-[9px]">Final</Badge>}
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Atendimento Inteligente & Robô de Triagem */}
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-5 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Roteiros de Atendimento Inteligente & Triagem</h3>
                  <p className="text-[11px] text-muted-foreground">Configuração de fluxos e roteiros automáticos para WhatsApp.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {botWorkspaceQuery.data?.url && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="text-xs gap-1.5 cursor-pointer"
                  >
                    <a href={botWorkspaceQuery.data.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Construtor de Fluxos</span>
                    </a>
                  </Button>
                )}
                <Button
                  onClick={() => setIsAddScriptOpen(true)}
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl shadow-xs gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Roteiro</span>
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {botScriptsQuery.isLoading ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-purple-500" />
                  Carregando roteiros...
                </div>
              ) : (botScriptsQuery.data?.length ?? 0) === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl">
                  Nenhum roteiro de triagem cadastrado no momento. Crie um roteiro ou use o construtor visual.
                </div>
              ) : (
                botScriptsQuery.data?.map((script: any) => {
                  const isActive = Boolean(script.active);
                  return (
                    <div
                      key={script.scriptId}
                      className="p-4 rounded-xl border border-border bg-muted/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-foreground truncate">{script.name}</h4>
                          <Badge className={isActive ? "bg-emerald-500 text-white text-[9px]" : "bg-muted text-muted-foreground text-[9px]"}>
                            {isActive ? "Em Operação" : "Pausado"}
                          </Badge>
                        </div>
                        {script.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{script.description}</p>
                        )}
                        {script.initialMessage && (
                          <p className="text-[11px] text-foreground/80 mt-1 italic">
                            &quot;{script.initialMessage}&quot;
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deactivateBotScriptMut.isPending}
                            onClick={() => deactivateBotScriptMut.mutate({ clientId: tenantKey, scriptId: script.scriptId })}
                            className="text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer"
                          >
                            Pausar Roteiro
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={activateBotScriptMut.isPending}
                            onClick={() => activateBotScriptMut.mutate({ clientId: tenantKey, scriptId: script.scriptId })}
                            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                          >
                            Ativar no WhatsApp
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Modal de Criação de Roteiro */}
          <Dialog open={isAddScriptOpen} onOpenChange={setIsAddScriptOpen}>
            <DialogContent className="sm:max-w-lg bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-600" />
                  Novo Roteiro de Atendimento
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Defina a instrução e acolhimento que o assistente utilizará para atender novos contatos.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateScript} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Nome do Roteiro</Label>
                  <Input
                    required
                    value={newScriptForm.name}
                    onChange={(e) => setNewScriptForm({ ...newScriptForm, name: e.target.value })}
                    placeholder="Ex: Triagem Geral de Clientes"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Descrição (Opcional)</Label>
                  <Input
                    value={newScriptForm.description}
                    onChange={(e) => setNewScriptForm({ ...newScriptForm, description: e.target.value })}
                    placeholder="Ex: Roteiro padrão para acolhimento inicial"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Mensagem Inicial de Acolhimento</Label>
                  <Input
                    value={newScriptForm.initialMessage}
                    onChange={(e) => setNewScriptForm({ ...newScriptForm, initialMessage: e.target.value })}
                    placeholder="Ex: Olá! Seja bem-vindo à nossa central de atendimento."
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Instruções do Assistente (System Prompt)</Label>
                  <Textarea
                    required
                    rows={4}
                    value={newScriptForm.systemPrompt}
                    onChange={(e) => setNewScriptForm({ ...newScriptForm, systemPrompt: e.target.value })}
                    placeholder="Ex: Você é o assistente virtual da empresa. Responda educadamente e solicite o número do pedido ou CPF."
                    className="text-xs resize-none"
                  />
                </div>

                <DialogFooter className="pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddScriptOpen(false)}
                    className="text-xs cursor-pointer"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={createBotScriptMut.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    {createBotScriptMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                    Criar Roteiro
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Conteúdo da Sub-Aba 3: Conexão WhatsApp (100% White-Label) */}
      {subTab === "whatsapp" && (
        <div className="space-y-6 animate-fade-in">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 mb-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 border",
                  isWhatsAppConnected
                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                    : "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                )}>
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    Conexão WhatsApp da Empresa
                    <Badge className={isWhatsAppConnected ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}>
                      {isWhatsAppConnected ? "Conectado" : "Desconectado"}
                    </Badge>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Canal oficial para atendimento de clientes e envio de mensagens operacionais.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => whatsappStatusQuery.refetch()}
                  className="text-xs cursor-pointer"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", whatsappStatusQuery.isFetching && "animate-spin")} />
                  Atualizar Status
                </Button>

                {isWhatsAppConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnectWhatsAppMutation.mutate({ clientId: tenantKey, confirmation: "DESCONECTAR" })}
                    disabled={disconnectWhatsAppMutation.isPending}
                    className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                  >
                    Desconectar WhatsApp
                  </Button>
                )}
              </div>
            </div>

            {/* Painel de Status / Leitura de QR Code */}
            {isWhatsAppConnected ? (
              <div className="p-6 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">WhatsApp Conectado e Operacional</h4>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                      {connectedPhone ? `Número ativo: ${connectedPhone}` : "Instância pronta para enviar e receber mensagens."}
                    </p>
                  </div>
                </div>

                <Badge variant="outline" className="border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 bg-white dark:bg-emerald-950">
                  Pronto para Atendimento
                </Badge>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-6 rounded-2xl bg-muted/20 border border-border flex flex-col items-center justify-center text-center">
                  {qrCodeData?.base64 ? (
                    <div className="flex flex-col items-center gap-4 py-2">
                      <div className="p-4 bg-white rounded-2xl shadow-md border border-slate-200">
                        <img
                          src={qrCodeData.base64.startsWith("data:") ? qrCodeData.base64 : `data:image/png;base64,${qrCodeData.base64}`}
                          alt="QR Code WhatsApp"
                          className="w-56 h-56 object-contain"
                        />
                      </div>

                      <div className="space-y-1 max-w-sm">
                        <h4 className="text-sm font-bold text-foreground">Escaneie o QR Code com seu WhatsApp</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          1. Abra o WhatsApp no celular &gt; Menu &gt; <strong>Aparelhos Conectados</strong><br />
                          2. Toque em <strong>Conectar um aparelho</strong> e aponte para a tela.
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => connectWhatsAppMutation.mutate({ clientId: tenantKey })}
                        disabled={connectWhatsAppMutation.isPending}
                        className="text-xs mt-2 cursor-pointer"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", connectWhatsAppMutation.isPending && "animate-spin")} />
                        Gerar Novo QR Code
                      </Button>
                    </div>
                  ) : (
                    <div className="py-6 flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
                        <QrCode className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-foreground">WhatsApp Desconectado</h4>
                      <p className="text-xs text-muted-foreground max-w-md">
                        Clique abaixo para gerar o QR Code de autenticação e conectar seu número empresarial à plataforma.
                      </p>
                      <Button
                        onClick={() => connectWhatsAppMutation.mutate({ clientId: tenantKey })}
                        disabled={connectWhatsAppMutation.isPending}
                        className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs gap-1.5 cursor-pointer"
                      >
                        {connectWhatsAppMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Smartphone className="w-4 h-4" />
                        )}
                        <span>Conectar WhatsApp</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo da Sub-Aba 4: Consumo & Auditoria de IA */}
      {subTab === "ia_audit" && (
        <div className="animate-fade-in min-h-[580px]">
          <AITokenUsagePage embedded={true} />
        </div>
      )}
    </div>
  );
}

export default AdminUnifiedHub;
