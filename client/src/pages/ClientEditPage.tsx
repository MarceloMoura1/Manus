import {
  ArrowLeft,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Trash2,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { MODULE_LABELS, normalizeModuleNamesToAdmin } from "@shared/const";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

type ClientTab = "dados" | "usuarios" | "permissoes" | "apis" | "acesso";

const PLAN_OPTIONS = [
  "Suporte + WhatsApp",
  "Atendimento BOT",
  "Integração avançada",
  "Plano Básico",
  "Plano Profissional",
  "Plano Enterprise",
];

// Módulos configuráveis da MegaDesk — devem coincidir com CONFIGURABLE_MODULES no backend
const ALL_MODULES = [
  "atendimento_ativo",
  "conversas",
  "chamados",
  "rastreio",
  "erp",
  "configurar_bot",
  "assistente_ia",
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  agent: "Agente",
  viewer: "Visualizador",
};

// Permissões por página/módulo da MegaDesk (usar MODULE_LABELS do shared/const.ts)
const PERMISSION_LABELS = MODULE_LABELS;

// Permissões padrão por função (espelha rolePermissions do backend)
const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin:   ["atendimento_ativo", "conversas", "chamados", "rastreio", "erp", "configurar_bot", "assistente_ia"],
  manager: ["atendimento_ativo", "conversas", "chamados", "rastreio", "erp", "configurar_bot", "assistente_ia"],
  agent:   ["atendimento_ativo", "conversas", "chamados"],
  viewer:  ["chamados"],
};

// ─── Aba: Dados do Cliente ────────────────────────────────────────────────────
function DadosTab({ client, onSaved }: { client: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    company: client.company ?? "",
    contact: client.contact ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    cnpj: client.cnpj ?? "",
    plan: client.plan ?? "",
    maxUsers: client.maxUsers ?? 5,
    statusType: (client.statusType ?? "test") as "active" | "test",
  });
  const [dirty, setDirty] = useState(false);

  const update = trpc.megaadmin.updateClientInfo.useMutation({
    onSuccess() {
      toast.success("Dados do cliente salvos com sucesso.");
      setDirty(false);
      onSaved();
    },
    onError(err) { toast.error(err.message); },
  });

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Empresa *
          <input
            value={form.company}
            onChange={(e) => setField("company", e.target.value)}
            placeholder="Nome da empresa"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Responsável *
          <input
            value={form.contact}
            onChange={(e) => setField("contact", e.target.value)}
            placeholder="Nome do responsável"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          E-mail *
          <input
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="email@empresa.com"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Telefone / WhatsApp *
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            placeholder="+55 11 99999-9999"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          CNPJ
          <input
            value={form.cnpj}
            onChange={(e) => setField("cnpj", e.target.value)}
            placeholder="00.000.000/0001-00"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Plano *
          <select
            value={form.plan}
            onChange={(e) => setField("plan", e.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Quantidade de usuários *
          <input
            type="number"
            min={1}
            max={500}
            value={form.maxUsers}
            onChange={(e) => setField("maxUsers", Number(e.target.value))}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Status do cliente
          <select
            value={form.statusType}
            onChange={(e) => setField("statusType", e.target.value as "active" | "test")}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
          >
            <option value="active">Ativo</option>
            <option value="test">Teste</option>
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
        <button
          onClick={() => {
            setForm({
              company: client.company ?? "",
              contact: client.contact ?? "",
              email: client.email ?? "",
              phone: client.phone ?? "",
              cnpj: client.cnpj ?? "",
              plan: client.plan ?? "",
              maxUsers: client.maxUsers ?? 5,
              statusType: client.statusType ?? "test",
            });
            setDirty(false);
          }}
          disabled={!dirty}
          className="rounded-2xl border border-white/10 px-5 py-2.5 text-sm text-slate-300 disabled:opacity-40"
        >
          Sair sem salvar
        </button>
        <button
          onClick={() => update.mutate({ clientId: client.clientId, ...form })}
          disabled={!dirty || update.isPending}
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {update.isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

// ─── Aba: Usuários ────────────────────────────────────────────────────────────
function UsuariosTab({ client, onRefresh }: { client: any; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "agent" as "admin" | "manager" | "agent" | "viewer" });
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  // Estado local otimista para cargo e status (evita reverter enquanto o refetch carrega)
  const [localRoles, setLocalRoles] = useState<Record<string, string>>({});
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  const users: any[] = client.users ?? [];
  const activeCount = users.filter((u: any) => u.status === "active").length;
  const maxUsers: number = client.maxUsers ?? 5;
  const limitReached = users.length >= maxUsers;

  const addUser = trpc.megaadmin.addClientUser.useMutation({
    onSuccess() {
      toast.success("Usuário adicionado.");
      setShowAdd(false);
      setNewUser({ name: "", email: "", role: "agent" });
      onRefresh();
    },
    onError(err) { toast.error(err.message); },
  });
  const updateUser = trpc.megaadmin.updateClientUser.useMutation({
    onSuccess() { toast.success("Usuário atualizado."); onRefresh(); },
    onError(err) {
      toast.error(err.message);
      // Reverte o estado local em caso de erro
      setLocalRoles({});
      setLocalStatus({});
    },
  });
  const removeUser = trpc.megaadmin.removeClientUser.useMutation({
    onSuccess() { toast.success("Usuário removido."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });
  const resetPwd = trpc.megaadmin.resetUserPassword.useMutation({
    onSuccess(data) {
      toast.success(data.message);
      setResetTarget(null);
      setNewPassword("");
    },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="space-y-5">
      {/* Controle de limite */}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[.03] px-5 py-4">
        <div>
          <p className="text-sm font-medium text-white">Controle de usuários</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {users.length} / {maxUsers} usuários cadastrados &bull; {activeCount} online/ativos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", activeCount > 0 ? "bg-emerald-400" : "bg-slate-600")} />
          <span className="text-xs text-slate-400">{activeCount} ativo(s)</span>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] px-5 py-3">
        <div className="mb-1.5 flex justify-between text-xs text-slate-400">
          <span>Usuários liberados</span>
          <span className={limitReached ? "text-red-400" : "text-emerald-400"}>{users.length}/{maxUsers}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-800">
          <div
            className={cn("h-1.5 rounded-full transition-all", limitReached ? "bg-red-400" : "bg-emerald-400")}
            style={{ width: `${Math.min(100, (users.length / maxUsers) * 100)}%` }}
          />
        </div>
        {limitReached && <p className="mt-1.5 text-xs text-red-400">Limite de usuários atingido. Aumente o limite nos dados do cliente.</p>}
      </div>

      {/* Botão adicionar */}
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-medium text-slate-300">Usuários cadastrados</h4>
        <button
          onClick={() => setShowAdd(true)}
          disabled={limitReached}
          className="flex items-center gap-2 rounded-2xl bg-emerald-400/10 border border-emerald-400/30 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UserPlus className="h-4 w-4" />
          Adicionar usuário
        </button>
      </div>

      {/* Formulário de novo usuário */}
      {showAdd && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5 space-y-4">
          <h5 className="text-sm font-semibold text-emerald-300">Novo usuário</h5>
          <div className="grid gap-4 md:grid-cols-3">
            <input
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              placeholder="Nome completo"
              className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400"
            />
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="email@empresa.com"
              className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
              className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400"
            >
              <option value="admin">Administrador</option>
              <option value="manager">Gerente</option>
              <option value="agent">Agente</option>
              <option value="viewer">Visualizador</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowAdd(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancelar</button>
            <button
              onClick={() => addUser.mutate({ clientId: client.clientId, ...newUser })}
              disabled={!newUser.name || !newUser.email || addUser.isPending}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {addUser.isPending ? "Adicionando..." : "Adicionar"}
            </button>
          </div>
        </div>
      )}

      {/* Lista de usuários */}
      <div className="space-y-3">
        {users.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">Nenhum usuário cadastrado.</p>
        ) : (
          users.map((user: any) => (
            <div key={user.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", (localStatus[user.id] ?? user.status) === "active" ? "bg-emerald-400" : "bg-slate-600")} />
                  <div>
                    <p className="text-sm font-medium text-white">{user.name}</p>
                    <p className="text-xs text-slate-400">{user.email} &bull; <span className="text-slate-300">{ROLE_LABELS[localRoles[user.id] ?? user.role] ?? (localRoles[user.id] ?? user.role)}</span></p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const newStatus = (localStatus[user.id] ?? user.status) === "active" ? "blocked" : "active";
                      setLocalStatus((prev) => ({ ...prev, [user.id]: newStatus }));
                      updateUser.mutate({ clientId: client.clientId, userId: user.id, status: newStatus as any });
                    }}
                    className={cn("flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition", (localStatus[user.id] ?? user.status) === "active" ? "border-red-400/20 text-red-300 hover:bg-red-400/10" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-400/10")}
                  >
                    {(localStatus[user.id] ?? user.status) === "active" ? <Lock className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    {(localStatus[user.id] ?? user.status) === "active" ? "Bloquear" : "Ativar"}
                  </button>
                  <select
                    value={localRoles[user.id] ?? user.role}
                    onChange={(e) => {
                      setLocalRoles((prev) => ({ ...prev, [user.id]: e.target.value }));
                      updateUser.mutate({ clientId: client.clientId, userId: user.id, role: e.target.value as any });
                    }}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white outline-none"
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Gerente</option>
                    <option value="agent">Agente</option>
                    <option value="viewer">Visualizador</option>
                  </select>
                  <button
                    onClick={() => setResetTarget({ id: user.id, name: user.name })}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40"
                  >
                    <KeyRound className="h-3 w-3" />
                    Resetar senha
                  </button>
                  <button
                    onClick={() => removeUser.mutate({ clientId: client.clientId, userId: user.id })}
                    className="flex items-center gap-1.5 rounded-xl border border-red-400/20 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal de reset de senha */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <h4 className="text-lg font-semibold text-white mb-1">Resetar senha</h4>
            <p className="text-sm text-slate-400 mb-4">Defina uma nova senha para <strong className="text-white">{resetTarget.name}</strong>.</p>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nova senha (mín. 6 caracteres)"
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 pr-12 text-white outline-none focus:border-emerald-400"
              />
              <button onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-3 text-slate-400">
                {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={() => { setResetTarget(null); setNewPassword(""); }} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancelar</button>
              <button
                onClick={() => resetPwd.mutate({ clientId: client.clientId, userId: resetTarget.id, newPassword })}
                disabled={newPassword.length < 6 || resetPwd.isPending}
                className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {resetPwd.isPending ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Aba: Permissões ──────────────────────────────────────────────────────────
function PermissoesTab({ client, onRefresh }: { client: any; onRefresh: () => void }) {
  const users = client.users ?? [];
  const [expandedUser, setExpandedUser] = useState<string>(users?.[0]?.id ?? "");
  const [editingPermissions, setEditingPermissions] = useState<Record<string, string[]>>({});

  const toggleModule = trpc.megaadmin.toggleModule.useMutation({
    onSuccess() { onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const updatePermissions = trpc.megaadmin.updateUserPermissions.useMutation({
    onSuccess() {
      toast.success("Permissões atualizadas com sucesso!");
      setEditingPermissions({});
      onRefresh();
    },
    onError(err) { toast.error(err.message); },
  });

  const activeModules: string[] = client.modules ?? [];

  return (
    <div className="space-y-6">
      {/* Seção: Permissões por Usuário */}
      <div>
        <div className="mb-6">
          <h4 className="text-lg font-bold text-white">Permissões por Usuário</h4>
          <p className="text-sm text-slate-400 mt-2">Gerencie o acesso de cada usuário aos módulos do sistema.</p>
        </div>

        {users.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-6 text-center">
            <p className="text-sm text-slate-400">Nenhum usuário cadastrado. Adicione usuários na aba "Usuários" para configurar permissões.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user: any) => (
              <div key={user.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 flex items-center justify-between hover:border-blue-500 hover:shadow-md transition">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                  <p className="text-xs text-slate-400 truncate">{user.email}</p>
                </div>
                <button
                  onClick={() => setExpandedUser(expandedUser === user.id ? "" : user.id)}
                  className="ml-3 p-2 rounded-lg hover:bg-blue-900/30 transition text-slate-400 hover:text-blue-400 flex-shrink-0"
                  title="Configurar permissões"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Painel de Edição de Permissões */}
        {expandedUser && users.find((u: any) => u.id === expandedUser) && (
          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/50 p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Permissões de {users.find((u: any) => u.id === expandedUser)?.name}</p>
                <p className="text-xs text-slate-400 mt-1">Selecione os módulos que este usuário pode acessar.</p>
              </div>
              <button
                onClick={() => setExpandedUser("")}
                className="p-1 rounded hover:bg-slate-800 transition"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {ALL_MODULES.map((mod) => {
                const user = users.find((u: any) => u.id === expandedUser);
                // Normalizar permissões do backend (hífen) para underscore antes de comparar com ALL_MODULES
                const rawPermissions = editingPermissions[expandedUser] ?? user?.permissions ?? [];
                const currentPermissions = normalizeModuleNamesToAdmin(rawPermissions);
                const hasPermission = currentPermissions.includes(mod);
                return (
                  <label key={mod} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer transition border border-slate-700 hover:border-blue-500">
                    <input
                      type="checkbox"
                      checked={hasPermission}
                      onChange={(e) => {
                        const newPermissions = e.target.checked
                          ? [...currentPermissions, mod]
                          : currentPermissions.filter((p: string) => p !== mod);
                        setEditingPermissions((prev) => ({ ...prev, [expandedUser]: newPermissions }));
                      }}
                      className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500/50"
                    />
                    <span className="text-sm text-slate-300">{(MODULE_LABELS as Record<string, string>)[mod] ?? mod}</span>
                  </label>
                );
              })}
            </div>
            {/* Botões de Ação */}
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setExpandedUser("")}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const newPermissions = editingPermissions[expandedUser] ?? users.find((u: any) => u.id === expandedUser)?.permissions ?? [];
                  updatePermissions.mutate({
                    clientId: client.clientId,
                    userId: expandedUser,
                    permissions: newPermissions,
                  });
                }}
                disabled={updatePermissions.isPending}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                {updatePermissions.isPending ? "Salvando..." : "Salvar Permissões"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Aba: APIs / Integrações ──────────────────────────────────────────────────
// ─── Painel de Uso de Tokens Gemini ─────────────────────────────────────────
function GeminiTokenUsagePanel({ clientId }: { clientId: string }) {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "all">("month");
  const { data, isLoading, refetch } = trpc.tokenUsage.getSummary.useQuery(
    { clientId, period },
    { refetchOnWindowFocus: false }
  );
  const { data: history, isLoading: histLoading } = trpc.tokenUsage.getHistory.useQuery(
    { clientId, limit: 10, offset: 0 },
    { refetchOnWindowFocus: false }
  );

  const periods = [
    { key: "today" as const, label: "Hoje" },
    { key: "week" as const, label: "7 dias" },
    { key: "month" as const, label: "30 dias" },
    { key: "all" as const, label: "Total" },
  ];

  const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const formatDate = (ts: number) => new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-purple-400/5 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-400" />
          <h4 className="text-sm font-semibold text-white">Uso de Tokens Gemini</h4>
          <span className="rounded-full bg-purple-400/10 border border-purple-400/20 px-2 py-0.5 text-xs text-purple-300">Controle financeiro</span>
        </div>
        <button onClick={() => refetch()} className="text-slate-400 hover:text-white transition">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Seletor de período */}
      <div className="flex gap-2">
        {periods.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "rounded-lg px-3 py-1 text-xs transition",
              period === p.key
                ? "bg-purple-500 text-white"
                : "border border-white/10 text-slate-400 hover:text-white"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm">Carregando...</div>
      ) : data ? (
        <>
          {/* Cards de métricas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-center">
              <div className="text-2xl font-bold text-purple-300">{formatTokens(data.totalTokens)}</div>
              <div className="text-xs text-slate-400 mt-0.5">Tokens usados</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-center">
              <div className="text-2xl font-bold text-emerald-300">R$ {data.estimatedCostBRL.toFixed(2)}</div>
              <div className="text-xs text-slate-400 mt-0.5">Custo estimado</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-center">
              <div className="text-2xl font-bold text-cyan-300">{data.totalCalls}</div>
              <div className="text-xs text-slate-400 mt-0.5">Chamadas IA</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-center">
              <div className="text-2xl font-bold text-yellow-300">{data.uniqueUsers}</div>
              <div className="text-xs text-slate-400 mt-0.5">Usuários ativos</div>
            </div>
          </div>

          {/* Detalhes de tokens */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 space-y-1">
              <div className="text-slate-400">Tokens de entrada (prompt)</div>
              <div className="text-white font-medium">{formatTokens(data.promptTokens)}</div>
              <div className="text-slate-500">$ {((data.promptTokens / 1_000_000) * 0.075).toFixed(4)} USD</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 space-y-1">
              <div className="text-slate-400">Tokens de saída (resposta)</div>
              <div className="text-white font-medium">{formatTokens(data.completionTokens)}</div>
              <div className="text-slate-500">$ {((data.completionTokens / 1_000_000) * 0.30).toFixed(4)} USD</div>
            </div>
          </div>

          {/* Top usuários */}
          {data.topUsers.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2">Top usuários por consumo</div>
              <div className="space-y-1.5">
                {data.topUsers.slice(0, 5).map((u) => (
                  <div key={u.email} className="flex items-center justify-between rounded-lg bg-white/[.02] px-3 py-2">
                    <span className="text-xs text-slate-300 truncate max-w-[60%]">{u.email || "(sem email)"}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-purple-300">{formatTokens(u.tokens)} tokens</span>
                      <span className="text-xs text-slate-500">{u.calls} chamadas</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custo total em destaque */}
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">Custo total estimado ({periods.find(p => p.key === period)?.label})</div>
              <div className="text-lg font-bold text-emerald-300 mt-0.5">R$ {data.estimatedCostBRL.toFixed(2)}</div>
              <div className="text-xs text-slate-500">${data.estimatedCostUSD.toFixed(4)} USD · Gemini 1.5 Flash</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">{data.totalConversations} conversas</div>
              <div className="text-xs text-slate-400">{data.functionCalls} function calls</div>
            </div>
          </div>

          {data.totalCalls === 0 && (
            <div className="text-center py-4 text-slate-500 text-sm">Nenhum uso registrado no período selecionado.</div>
          )}
        </>
      ) : null}

      {/* Histórico recente */}
      {history && history.items.length > 0 && (
        <div>
          <div className="text-xs text-slate-400 mb-2">Últimas chamadas</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {history.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg bg-white/[.02] px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 shrink-0">{formatDate(item.createdAt)}</span>
                  <span className="text-slate-300 truncate">{item.userEmail || "(sem email)"}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-purple-300">{formatTokens(item.totalTokens)} tk</span>
                  {item.functionCallsCount > 0 && (
                    <span className="text-yellow-400">{item.functionCallsCount} fn</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ApisTab({ client, onRefresh }: { client: any; onRefresh: () => void }) {
  const intg = client.integrations ?? {};
  const [form, setForm] = useState({
    geminiKey: intg.geminiKey ?? "",
    trackingToken: intg.trackingToken ?? "",
    trackingUser: intg.trackingUser ?? "",
    trackingPassword: intg.trackingPassword ?? "",
    trackingContract: intg.trackingContract ?? "",
    n8nUrl: intg.n8nUrl ?? "",
    n8nToken: intg.n8nToken ?? "",
    erpNotes: intg.erpNotes ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  const [showPwd, setShowPwd] = useState(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const save = trpc.megaadmin.saveClientIntegrations.useMutation({
    onSuccess() {
      toast.success("Integrações salvas com sucesso.");
      setDirty(false);
      onRefresh();
    },
    onError(err) { toast.error(err.message); },
  });

  const test = trpc.megaadmin.testIntegration.useMutation({
    onSuccess(data, vars) {
      setTestResults((prev) => ({ ...prev, [vars.type]: data }));
      if (data.ok) {
        toast.success(data.message);
        onRefresh();
      } else {
        toast.error(data.message);
      }
    },
    onError(err) { toast.error(err.message); },
  });

  function TestBadge({ type }: { type: "gemini" | "tracking" | "n8n" }) {
    const result = testResults[type];
    return (
      <button
        onClick={() => test.mutate({
          clientId: client.clientId,
          type,
          // Passa o valor atual do formulário para o Gemini, sem precisar salvar antes
          ...(type === "gemini" && form.geminiKey ? { geminiKeyOverride: form.geminiKey } : {}),
        })}
        disabled={test.isPending}
        className={cn(
          "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition",
          result === null ? "border-white/10 text-slate-400" :
          result?.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" :
          "border-red-400/30 bg-red-400/10 text-red-300",
        )}
      >
        <RefreshCw className={cn("h-3 w-3", test.isPending && "animate-spin")} />
        {result === undefined ? "Testar conexão" : result?.ok ? "Conexão OK" : "Falhou"}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      {/* Gemini IA */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-400" />
            <h4 className="text-sm font-semibold text-white">Gemini IA</h4>
          </div>
          <TestBadge type="gemini" />
        </div>
        <label className="block text-xs text-slate-400">
          Token API
          <input
            value={form.geminiKey}
            onChange={(e) => setField("geminiKey", e.target.value)}
            placeholder="AIza..."
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-400"
          />
        </label>
      </div>

      {/* Painel de uso de tokens */}
      <GeminiTokenUsagePanel clientId={client.clientId} />

      {/* Rastreio */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-cyan-400" />
            <h4 className="text-sm font-semibold text-white">Rastreio</h4>
          </div>
          <TestBadge type="tracking" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-xs text-slate-400">
            Token API
            <input
              value={form.trackingToken}
              onChange={(e) => setField("trackingToken", e.target.value)}
              placeholder="Token de rastreio"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Usuário (Correios)
            <input
              value={form.trackingUser}
              onChange={(e) => setField("trackingUser", e.target.value)}
              placeholder="Usuário dos Correios"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Senha (Correios)
            <div className="relative mt-1.5">
              <input
                type={showPwd ? "text" : "password"}
                value={form.trackingPassword}
                onChange={(e) => setField("trackingPassword", e.target.value)}
                placeholder="Senha dos Correios"
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 pr-10 text-sm text-white outline-none focus:border-cyan-400"
              />
              <button onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-2.5 text-slate-400">
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <label className="block text-xs text-slate-400">
            N° do Contrato
            <input
              value={form.trackingContract}
              onChange={(e) => setField("trackingContract", e.target.value)}
              placeholder="Número do contrato"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
            />
          </label>
        </div>
      </div>

      {/* n8n */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            <h4 className="text-sm font-semibold text-white">n8n</h4>
          </div>
          <TestBadge type="n8n" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-xs text-slate-400">
            URL do servidor
            <input
              value={form.n8nUrl}
              onChange={(e) => setField("n8nUrl", e.target.value)}
              placeholder="https://n8n.suaempresa.com"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-yellow-400"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Token API
            <input
              value={form.n8nToken}
              onChange={(e) => setField("n8nToken", e.target.value)}
              placeholder="Token de autenticação"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-yellow-400"
            />
          </label>
        </div>
      </div>

      {/* ERP */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-orange-400" />
          <h4 className="text-sm font-semibold text-white">ERP</h4>
          <span className="rounded-full bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 text-xs text-orange-300">Em breve</span>
        </div>
        <label className="block text-xs text-slate-400">
          Observações / Configurações
          <textarea
            value={form.erpNotes}
            onChange={(e) => setField("erpNotes", e.target.value)}
            placeholder="Anote aqui informações sobre o ERP do cliente (sistema, versão, contato técnico...)"
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-orange-400 resize-none"
          />
        </label>
      </div>

      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
        <button
          onClick={() => {
            setForm({
              geminiKey: intg.geminiKey ?? "",
              trackingToken: intg.trackingToken ?? "",
              trackingUser: intg.trackingUser ?? "",
              trackingPassword: intg.trackingPassword ?? "",
              trackingContract: intg.trackingContract ?? "",
              n8nUrl: intg.n8nUrl ?? "",
              n8nToken: intg.n8nToken ?? "",
              erpNotes: intg.erpNotes ?? "",
            });
            setDirty(false);
          }}
          disabled={!dirty}
          className="rounded-2xl border border-white/10 px-5 py-2.5 text-sm text-slate-300 disabled:opacity-40"
        >
          Sair sem salvar
        </button>
        <button
          onClick={() => save.mutate({ clientId: client.clientId, integrations: form })}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Salvando..." : "Salvar integrações"}
        </button>
      </div>
    </div>
  );
}

// ─── Aba: Acesso ──────────────────────────────────────────────────────────────
function AcessoTab({ client, onRefresh }: { client: any; onRefresh: () => void }) {
  const isActive = client.status === "active" && client.accessReleased;

  const updateAccess = trpc.megaadmin.updateClientAccess.useMutation({
    onSuccess() { toast.success("Acesso atualizado."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });
  const rotateToken = trpc.megaadmin.rotateToken.useMutation({
    onSuccess() { toast.success("Token rotacionado com sucesso."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="space-y-5">
      {/* Status atual */}
      <div className={cn(
        "rounded-2xl border p-5",
        isActive ? "border-emerald-400/30 bg-emerald-400/5" : "border-red-400/20 bg-red-400/5",
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("h-3 w-3 rounded-full", isActive ? "bg-emerald-400" : "bg-red-400")} />
          <div>
            <p className="text-sm font-semibold text-white">
              {isActive ? "Acesso ativo e liberado" : "Acesso bloqueado ou em configuração"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Status: <span className="text-slate-200">{client.status}</span> &bull;
              Liberado: <span className="text-slate-200">{client.accessReleased ? "Sim" : "Não"}</span> &bull;
              Tipo: <span className="text-slate-200">{client.statusType === "active" ? "Ativo" : "Teste"}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Ações de acesso */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
          <h4 className="text-sm font-semibold text-white mb-1">Liberar acesso</h4>
          <p className="text-xs text-slate-400 mb-4">Ativa o cliente e libera o acesso à plataforma MegaDesk.</p>
          <button
            onClick={() => updateAccess.mutate({ clientId: client.clientId, status: "active", accessReleased: true })}
            disabled={isActive || updateAccess.isPending}
            className="w-full rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {updateAccess.isPending ? "Atualizando..." : "Liberar acesso"}
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
          <h4 className="text-sm font-semibold text-white mb-1">Bloquear acesso</h4>
          <p className="text-xs text-slate-400 mb-4">Bloqueia o cliente e todos os seus usuários imediatamente.</p>
          <button
            onClick={() => updateAccess.mutate({ clientId: client.clientId, status: "paused", accessReleased: false })}
            disabled={!isActive || updateAccess.isPending}
            className="w-full rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-300 disabled:opacity-50"
          >
            {updateAccess.isPending ? "Atualizando..." : "Bloquear acesso"}
          </button>
        </div>
      </div>

      {/* Token de integração */}
      <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-semibold text-white">Token de integração MegaDesk</h4>
        </div>
        <p className="text-xs text-slate-400">Token usado para autenticar esta conta na plataforma MegaDesk.</p>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3">
          <code className="flex-1 text-xs text-cyan-300 font-mono truncate">{client.tokenHint ?? "••••••••••••"}</code>
          <button
            onClick={() => rotateToken.mutate({ clientId: client.clientId })}
            disabled={rotateToken.isPending}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40"
          >
            <RefreshCw className={cn("h-3 w-3", rotateToken.isPending && "animate-spin")} />
            Rotacionar
          </button>
        </div>
        <p className="text-xs text-slate-500">⚠ Rotacionar o token invalida o acesso atual até que o novo token seja configurado.</p>
      </div>
    </div>
  );
}

// ─── Página Principal de Edição ───────────────────────────────────────────────
const TABS: { key: ClientTab; label: string; icon: React.ElementType }[] = [
  { key: "dados", label: "Dados", icon: Building2 },
  { key: "usuarios", label: "Usuários", icon: Users },
  { key: "permissoes", label: "Permissões", icon: Shield },
  { key: "apis", label: "APIs", icon: Zap },
  { key: "acesso", label: "Acesso", icon: Settings },
];

export function ClientEditPage({
  client,
  onBack,
  onRefresh,
}: {
  client: any;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ClientTab>("dados");
  const utils = trpc.useUtils();

  function refresh() {
    utils.megaadmin.summary.invalidate();
    onRefresh();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:border-cyan-400/40 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white">{client.company}</h2>
            <span className={cn(
              "rounded-full px-3 py-0.5 text-xs font-medium",
              client.statusType === "active" ? "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20" : "bg-yellow-400/10 text-yellow-300 border border-yellow-400/20",
            )}>
              {client.statusType === "active" ? "Ativo" : "Teste"}
            </span>
            <span className={cn(
              "rounded-full px-3 py-0.5 text-xs font-medium",
              client.accessReleased && client.status === "active" ? "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20" : "bg-red-400/10 text-red-300 border border-red-400/20",
            )}>
              {client.accessReleased && client.status === "active" ? "Acesso liberado" : "Bloqueado"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{client.plan} &bull; {client.contact} &bull; {client.phone}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/50 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition whitespace-nowrap",
              activeTab === key
                ? "bg-gradient-to-r from-emerald-400/20 to-cyan-400/20 text-white border border-white/10"
                : "text-slate-400 hover:text-slate-200",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
        {activeTab === "dados" && <DadosTab client={client} onSaved={refresh} />}
        {activeTab === "usuarios" && <UsuariosTab client={client} onRefresh={refresh} />}
        {activeTab === "permissoes" && <PermissoesTab client={client} onRefresh={refresh} />}
        {activeTab === "apis" && <ApisTab client={client} onRefresh={refresh} />}
        {activeTab === "acesso" && <AcessoTab client={client} onRefresh={refresh} />}
      </div>
    </div>
  );
}
