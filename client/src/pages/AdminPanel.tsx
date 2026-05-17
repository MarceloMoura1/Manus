import {
  Bot,
  Building2,
  Check,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Menu,
  Plus,
  Radar,
  Settings,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import { MODULE_LABELS } from "@shared/const";
import { AdminsSection } from "./AdminsSection";
import { ClientEditPage } from "./ClientEditPage";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

// ─── Módulos disponíveis (devem coincidir com CONFIGURABLE_MODULES no backend) ────────────────────────────────────────────
const ALL_MODULES = [
  "atendimento_ativo",
  "conversas",
  "chamados",
  "rastreio",
  "erp",
  "configurar_bot",
  "assistente_ia",
] as const;

type ModuleName = (typeof ALL_MODULES)[number];

// MODULE_LABELS importado de @shared/const

type Section = "dashboard" | "clients" | "users" | "admins" | "backups";
// ─── Helpers ────────────────────────────────────────────────────────────────
function getAdminLoginUrl() {
  const origin = window.location.origin;
  const returnPath = "/admin";
  const state = btoa(JSON.stringify({ origin, returnPath }));
  const callbackUrl = `${origin}/api/oauth/callback`;
  const portalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL ?? "https://manus.im";
  const appId = import.meta.env.VITE_APP_ID ?? "";
  return `${portalUrl}/login?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[.02] p-8 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function DeleteClientButton({ client, onSuccess }: { client: any; onSuccess: () => void }) {
  const deleteClientMutation = trpc.megaadmin.deleteClient.useMutation({
    onSuccess() {
      toast.success(`Cliente ${client.company} foi excluído com sucesso.`);
      onSuccess();
    },
    onError(err: any) {
      toast.error(err.message || "Erro ao excluir cliente");
    },
  });

  return (
    <button
      onClick={() => {
        if (confirm(`Tem certeza que deseja excluir o cliente "${client.company}"? Esta ação não pode ser desfeita.`)) {
          deleteClientMutation.mutate({ clientId: client.clientId });
        }
      }}
      disabled={deleteClientMutation.isPending}
      className="rounded-xl border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:border-red-400/60 hover:bg-red-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {deleteClientMutation.isPending ? "Excluindo..." : "Excluir"}
    </button>
  );
}

function MetricCard({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  caption: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20 backdrop-blur transition hover:-translate-y-1 hover:border-emerald-400/40">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <strong className="mt-2 block text-3xl font-semibold text-white">{value}</strong>
          <span className="mt-1 block text-xs text-slate-500">{caption}</span>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-400/20 to-cyan-400/20 p-3 text-emerald-300 ring-1 ring-white/10">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function ModuleToggle({
  name,
  enabled,
  onToggle,
  readonly = false,
}: {
  name: string;
  enabled: boolean;
  onToggle?: () => void;
  readonly?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={readonly}
      onClick={onToggle}
      className={cn(
        "rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-400",
        enabled
          ? "border-emerald-400/70 bg-emerald-400/10 shadow-lg shadow-emerald-950/30"
          : "border-white/10 bg-slate-900/70 hover:border-cyan-400/50 hover:bg-cyan-400/5",
        readonly && "cursor-default",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={cn("rounded-xl p-2", enabled ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-cyan-300")}>
          <Zap className="h-5 w-5" />
        </span>
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg border",
            enabled ? "border-emerald-300 bg-emerald-300 text-slate-950" : "border-slate-700 text-slate-600",
          )}
        >
          {enabled ? <Check className="h-4 w-4" /> : null}
        </span>
      </div>
      <strong className="mt-4 block text-sm text-white">{name}</strong>
    </button>
  );
}

// ─── Login Screen (e-mail + senha próprio) ───────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const loginMutation = trpc.megaadmin.loginAdmin.useMutation({
    onSuccess(data) {
      // Save JWT token to localStorage so tRPC sends it as Authorization header
      if (data.token) {
        localStorage.setItem("megadesk-session-token", data.token);
      }
      // Invalidate auth.me cache so the panel re-checks auth state with the new token
      utils.auth.me.invalidate();
    },
    onError(err) {
      setError(err.message || "E-mail ou senha incorretos.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) return;
    loginMutation.mutate({ email: email.trim(), password });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,.20),transparent_40%),#020617] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
        {/* Left panel */}
        <section className="relative flex flex-col justify-between p-8 lg:p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-slate-950 shadow-lg shadow-emerald-950/30">
              <Radar className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">MegaAdmin</h1>
              <p className="text-sm text-slate-400">Administração segura de clientes e permissões</p>
            </div>
          </div>

          <div className="my-16 max-w-2xl">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              Clientes • Usuários • Módulos • Tokens
            </span>
            <h2 className="mt-8 text-5xl font-semibold leading-tight tracking-tight lg:text-7xl">
              Controle administrativo com identidade forte e acesso por módulo.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Cadastre clientes, libere acesso à MegaDesk, gerencie usuários por cliente e controle quais módulos cada
              conta pode utilizar.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Clientes", "Cadastro e gestão"],
              ["Módulos", "Controle por conta"],
              ["Tokens", "Integração segura"],
            ].map(([value, label]) => (
              <div key={value} className="rounded-2xl border border-white/10 bg-white/[.04] p-4 backdrop-blur">
                <strong className="block text-xl text-white">{value}</strong>
                <span className="text-sm text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right panel — formulário de login próprio */}
        <section className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-950/80 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="mb-8">
              <div className="mb-5 inline-flex rounded-2xl bg-cyan-400/10 p-3 text-cyan-200 ring-1 ring-cyan-400/20">
                <Lock className="h-6 w-6" />
              </div>
              <h2 className="text-3xl font-semibold">Entrar no MegaAdmin</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Acesso exclusivo para administradores autorizados.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* E-mail */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    ref={emailRef}
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-600 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </div>
              </div>

              {/* Senha */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPwd ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900 py-3 pl-10 pr-12 text-sm text-white placeholder-slate-600 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Erro */}
              {error && (
                <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </p>
              )}

              {/* Botão */}
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loginMutation.isPending ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                ) : (
                  <>
                    Entrar como Administrador
                    <ChevronRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

// ─── Access Denied Screen ────────────────────────────────────────────────────
function AccessDeniedScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-[2rem] border border-red-400/20 bg-red-400/10 p-8 text-center">
        <div className="mb-5 inline-flex rounded-2xl bg-red-400/10 p-4 text-red-200 ring-1 ring-red-400/20">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-semibold text-white">Acesso restrito</h2>
        <p className="mt-3 text-sm leading-6 text-red-100/80">
          Sua conta não possui permissão de administrador para acessar o MegaAdmin. Contate o responsável técnico para
          obter acesso.
        </p>
        <button
          onClick={onLogout}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition hover:border-red-400/40 hover:text-red-200"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </main>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: "dashboard" as Section, label: "Dashboard", icon: LayoutDashboard },
  { key: "clients" as Section, label: "Clientes", icon: Building2 },
  { key: "users" as Section, label: "Usuários", icon: Users },
  { key: "admins" as Section, label: "Administradores", icon: ShieldCheck },
  { key: "backups" as Section, label: "Backups", icon: Database },
];

function Sidebar({
  active,
  setActive,
  userName,
  userEmail,
  onLogout,
}: {
  active: Section;
  setActive: (s: Section) => void;
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-80 shrink-0 border-r border-white/10 bg-slate-950/95 p-5 shadow-2xl shadow-black/30 backdrop-blur xl:block">
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[.03] p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-slate-950">
          <Radar className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">MegaAdmin</h1>
          <p className="text-xs text-slate-400">Admin Center</p>
        </div>
      </div>

      <nav className="mt-8 space-y-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition",
                selected
                  ? "bg-gradient-to-r from-emerald-400/20 to-cyan-400/10 text-emerald-100 ring-1 ring-emerald-400/30"
                  : "text-slate-400 hover:bg-white/[.04] hover:text-white",
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="absolute inset-x-5 bottom-5 rounded-3xl border border-white/10 bg-white/[.03] p-4">
        <p className="text-sm font-medium text-white">{userName}</p>
        <p className="mt-1 truncate text-xs text-slate-400">{userEmail}</p>
        <button
          onClick={onLogout}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-red-400/40 hover:text-red-200"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </aside>
  );
}

// ─── Mobile Navigation ────────────────────────────────────────────────────────
function MobileNav({
  active,
  setActive,
}: {
  active: Section;
  setActive: (s: Section) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="xl:hidden">
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white"
      >
        <Menu className="h-5 w-5" /> Menu
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] overflow-auto rounded-[2rem] border border-white/10 bg-slate-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <strong className="text-white">MegaAdmin</strong>
              <button onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300">
                Fechar
              </button>
            </div>
            <nav className="space-y-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => { setActive(item.key); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition",
                      active === item.key
                        ? "bg-gradient-to-r from-emerald-400/20 to-cyan-400/10 text-emerald-100 ring-1 ring-emerald-400/30"
                        : "text-slate-400 hover:bg-white/[.04] hover:text-white",
                    )}
                  >
                    <Icon className="h-5 w-5" /> {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Client Wizard Modal ──────────────────────────────────────────────────────
const PLAN_OPTIONS_WIZARD = ["Suporte + WhatsApp","Atendimento BOT","Integração avançada","Plano Básico","Plano Profissional","Plano Enterprise"];
type NewClientForm = { company: string; contact: string; email: string; phone: string; cnpj: string; plan: string; maxUsers: number; statusType: "active" | "test" };
const defaultNewClient: NewClientForm = { company: "", contact: "", email: "", phone: "", cnpj: "", plan: "Suporte + WhatsApp", maxUsers: 5, statusType: "test" };

function ClientWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewClientForm>(defaultNewClient);
  const create = trpc.megaadmin.createClient.useMutation({
    onSuccess() {
      toast.success("Cliente cadastrado! Redirecionando para a área de clientes...");
      onCreated();
      onClose();
    },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-white">Cadastrar novo cliente</h3>
            <p className="text-sm text-slate-400">Preencha os dados básicos para criar a conta.</p>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300">
            Fechar
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-slate-300">Empresa *<input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Nome da empresa" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">Responsável *<input type="text" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Nome do responsável" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">E-mail *<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@empresa.com" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">Telefone / WhatsApp *<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+55 11 99999-9999" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">CNPJ<input type="text" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0001-00" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">Plano *<select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400">{PLAN_OPTIONS_WIZARD.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label className="block text-sm text-slate-300">Qtd. de usuários *<input type="number" min={1} max={500} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400" /></label>
          <label className="block text-sm text-slate-300">Status<select value={form.statusType} onChange={(e) => setForm({ ...form, statusType: e.target.value as "active" | "test" })} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"><option value="test">Teste</option><option value="active">Ativo</option></select></label>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-slate-300">
            Cancelar
          </button>
          <button
            onClick={() => create.mutate(form)}
            disabled={!form.company || !form.contact || !form.email || !form.phone || create.isPending}
            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {create.isPending ? "Cadastrando..." : "Finalizar cadastro"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Client Detail Panel ──────────────────────────────────────────────────────
function ClientDetail({ client, onClose, onRefresh }: { client: any; onClose: () => void; onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "agent" as "admin" | "manager" | "agent" | "viewer" });
  const [editingModules, setEditingModules] = useState<string[]>(client.modules ?? []);
  const [editingInfo, setEditingInfo] = useState({ email: client.email ?? "", cnpj: client.cnpj ?? "" });
  const [showEditInfo, setShowEditInfo] = useState(false);

  const updateAccess = trpc.megaadmin.updateClientAccess.useMutation({
    onSuccess() { toast.success("Acesso atualizado."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const addUser = trpc.megaadmin.addClientUser.useMutation({
    onSuccess() { toast.success("Usuário adicionado."); setShowAddUser(false); setNewUser({ name: "", email: "", role: "agent" }); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const updateUser = trpc.megaadmin.updateClientUser.useMutation({
    onSuccess() { toast.success("Usuário atualizado."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const removeUser = trpc.megaadmin.removeClientUser.useMutation({
    onSuccess() { toast.success("Usuário removido."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const toggleModule = trpc.megaadmin.toggleModule.useMutation({
    onSuccess(data) {
      setEditingModules(data.modules);
      onRefresh();
    },
    onError(err) { toast.error(err.message); },
  });

  const rotateToken = trpc.megaadmin.rotateToken.useMutation({
    onSuccess() { toast.success("Token rotacionado com sucesso."); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const updateClientInfo = trpc.megaadmin.updateClientInfo.useMutation({
    onSuccess() { toast.success("Informações do cliente atualizadas."); setShowEditInfo(false); onRefresh(); },
    onError(err) { toast.error(err.message); },
  });

  const isActive = client.status === "active" && client.accessReleased;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 backdrop-blur">
      <div className="my-8 w-full max-w-4xl rounded-[2rem] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-white">{client.company}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {client.contact} • {client.phone} • {client.plan}
            </p>
            <span
              className={cn(
                "mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium",
                isActive ? "bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-400/30" : "bg-amber-300/10 text-amber-200 ring-1 ring-amber-300/30",
              )}
            >
              {isActive ? "Ativo" : client.status === "paused" ? "Pausado" : "Em configuração"}
            </span>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300">
            Fechar
          </button>
        </div>

        {/* Client Info Edit */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[.03] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Informações do cliente</h4>
            <button
              onClick={() => setShowEditInfo(!showEditInfo)}
              className="rounded-2xl bg-blue-400/10 px-3 py-1.5 text-xs text-blue-200 ring-1 ring-blue-400/30 hover:bg-blue-400/20"
            >
              {showEditInfo ? "Cancelar" : "Editar"}
            </button>
          </div>
          {showEditInfo ? (
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="email"
                value={editingInfo.email}
                onChange={(e) => setEditingInfo({ ...editingInfo, email: e.target.value })}
                placeholder="E-mail"
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
              />
              <input
                type="text"
                value={editingInfo.cnpj}
                onChange={(e) => setEditingInfo({ ...editingInfo, cnpj: e.target.value })}
                placeholder="CNPJ (00.000.000/0001-00)"
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
              />
              <button
                onClick={() => updateClientInfo.mutate({ clientId: client.clientId, email: editingInfo.email, cnpj: editingInfo.cnpj })}
                disabled={updateClientInfo.isPending}
                className="rounded-xl bg-blue-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50 md:col-span-2"
              >
                Salvar
              </button>
            </div>
          ) : (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs text-slate-400">E-mail</p>
                <p className="text-white">{client.email || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">CNPJ</p>
                <p className="text-white">{client.cnpj || "—"}</p>
              </div>
            </div>
          )}
        </div>

        {/* Access control */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[.03] p-5">
          <h4 className="mb-3 text-sm font-semibold text-white">Controle de acesso</h4>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => updateAccess.mutate({ clientId: client.clientId, status: "active", accessReleased: true })}
              disabled={isActive || updateAccess.isPending}
              className="rounded-2xl bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200 ring-1 ring-emerald-400/30 disabled:opacity-40 hover:bg-emerald-400/20"
            >
              Liberar acesso
            </button>
            <button
              onClick={() => updateAccess.mutate({ clientId: client.clientId, status: "paused", accessReleased: false })}
              disabled={!isActive || updateAccess.isPending}
              className="rounded-2xl bg-red-400/10 px-4 py-2 text-sm text-red-200 ring-1 ring-red-400/30 disabled:opacity-40 hover:bg-red-400/20"
            >
              Bloquear acesso
            </button>
            <button
              onClick={() => rotateToken.mutate({ clientId: client.clientId })}
              disabled={rotateToken.isPending}
              className="rounded-2xl bg-cyan-400/10 px-4 py-2 text-sm text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-400/20"
            >
              Rotacionar token
            </button>
          </div>
          {client.tokenHint && (
            <p className="mt-3 text-xs text-slate-500">
              Token atual: <code className="text-slate-300">{client.tokenHint}</code>
            </p>
          )}
        </div>

        {/* Modules */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[.03] p-5">
          <h4 className="mb-3 text-sm font-semibold text-white">Módulos liberados</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_MODULES.map((mod) => (
              <ModuleToggle
                key={mod}
                name={MODULE_LABELS[mod]}
                enabled={editingModules.includes(mod)}
                onToggle={() => toggleModule.mutate({ clientId: client.clientId, module: mod, enabled: !editingModules.includes(mod) })}
              />
            ))}
          </div>
        </div>

        {/* Users */}
        <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h4 className="text-sm font-semibold text-white">Usuários</h4>
            <button
              onClick={() => setShowAddUser(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-400/20"
            >
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          </div>

          {showAddUser && (
            <div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4 md:grid-cols-4">
              <input
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Nome"
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none"
              />
              <input
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="E-mail"
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none"
              />
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as typeof newUser.role })}
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="agent">agent</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                onClick={() => addUser.mutate({ clientId: client.clientId, ...newUser })}
                disabled={!newUser.name || !newUser.email || addUser.isPending}
                className="rounded-xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          )}

          <div className="space-y-3">
            {(client.users ?? []).length === 0 ? (
              <EmptyState text="Nenhum usuário cadastrado para este cliente." />
            ) : (
              (client.users ?? []).map((user: any) => (
                <div key={user.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{user.name}</p>
                    <p className="text-xs text-slate-400">
                      {user.email} • {user.role} •{" "}
                      <span className={user.status === "active" ? "text-emerald-300" : "text-red-300"}>{user.status}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateUser.mutate({ clientId: client.clientId, userId: user.id, status: user.status === "active" ? "blocked" : "active" })}
                      className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40"
                    >
                      <UserCog className="mr-1 inline h-3.5 w-3.5" />
                      {user.status === "active" ? "Bloquear" : "Ativar"}
                    </button>
                    <button
                      onClick={() => removeUser.mutate({ clientId: client.clientId, userId: user.id })}
                      className="rounded-xl border border-red-400/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-400/10"
                    >
                      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                      Remover
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DarkModeWrapper: aplica dark mode no body antes de qualquer renderização ──────────────────────────────────────────────────────────
function DarkModeWrapper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const prevBg = document.body.style.background;
    const prevColor = document.body.style.color;
    const prevColorScheme = document.documentElement.style.colorScheme;
    document.body.style.background = "#020617";
    document.body.style.color = "#f1f5f9";
    document.documentElement.style.colorScheme = "dark";
    return () => {
      document.body.style.background = prevBg;
      document.body.style.color = prevColor;
      document.documentElement.style.colorScheme = prevColorScheme;
    };
  }, []);
  return <>{children}</>;
}

// ─── Helpers de sessão ────────────────────────────────────────────────────────
/** Decodifica o payload de um JWT (base64url) e retorna o timestamp de expiração em ms. */
function getJwtExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64 padrão
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// ─── Main AdminPanel ──────────────────────────────────────────────────────────
export default function AdminPanel() {
  const authQuery = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const logoutMutation = trpc.megaadmin.logoutAdmin.useMutation({
    onSuccess() {
      // Clear the admin token from localStorage
      localStorage.removeItem("megadesk-session-token");
      // Invalidate auth.me cache to return to login screen
      utils.auth.me.invalidate();
    },
  });

  // Verificar expiração do JWT e redirecionar automaticamente
  useEffect(() => {
    const token = localStorage.getItem("megadesk-session-token");
    if (!token) return;
    const expiry = getJwtExpiry(token);
    if (!expiry) return;
    const msUntilExpiry = expiry - Date.now();
    if (msUntilExpiry <= 0) {
      // Já expirou
      localStorage.removeItem("megadesk-session-token");
      utils.auth.me.invalidate();
      return;
    }
    // Agendar logout automático
    const timer = setTimeout(() => {
      localStorage.removeItem("megadesk-session-token");
      utils.auth.me.invalidate();
      toast.warning("Sessão expirada. Por favor, faça login novamente.");
    }, msUntilExpiry);
    return () => clearTimeout(timer);
  }, [utils]);

  const [active, setActive] = useState<Section>("dashboard");
  const [showWizard, setShowWizard] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);

  const summaryQuery = trpc.megaadmin.summary.useQuery(undefined, {
    enabled: authQuery.data?.user?.role === "admin",
    refetchInterval: 60_000, // Aumentado para 60 segundos para evitar perda de dados
    staleTime: 30_000, // Dados considerados frescos por 30 segundos
  });
  const refresh = () => {
    utils.megaadmin.summary.invalidate();
  };

  // Loading
  if (authQuery.isLoading) {
    return (
      <DarkModeWrapper>
        <main className="flex min-h-screen items-center justify-center" style={{ background: "#020617" }}>
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-400 border-t-transparent" />
            <p className="text-sm text-slate-400">Verificando autenticação…</p>
          </div>
        </main>
      </DarkModeWrapper>
    );
  }

  // Not logged in
  if (!authQuery.data?.user) {
    return (
      <DarkModeWrapper>
        <LoginScreen />
      </DarkModeWrapper>
    );
  }

  // Logged in but not admin
  if (authQuery.data.user.role !== "admin") {
    return (
      <DarkModeWrapper>
        <AccessDeniedScreen onLogout={() => logoutMutation.mutate()} />
      </DarkModeWrapper>
    );
  }

  const user = authQuery.data.user;
  const summary = summaryQuery.data;
  const clients: any[] = summary?.clients ?? [];

  const logout = () => logoutMutation.mutate();

  return (
    <DarkModeWrapper>
      <Toaster richColors position="top-right" />
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(14,165,233,.14),transparent_28%)]" />
        <div className="relative flex min-h-screen">
          <Sidebar
            active={active}
            setActive={setActive}
            userName={user.name ?? "Administrador"}
            userEmail={user.email ?? ""}
            onLogout={logout}
          />

          <main className="min-w-0 flex-1 p-4 md:p-8">
            {/* Header */}
            <header className="mb-8 flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[.03] p-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-emerald-300">MegaAdmin</p>
                  <h2 className="mt-1 text-3xl font-semibold text-white">
                    {active === "dashboard" ? "Dashboard administrativo" : active === "clients" ? "Clientes" : active === "users" ? "Usuários" : "Administradores"}
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Controle clientes, usuários e módulos com acesso sincronizado à MegaDesk.
                  </p>
                </div>
                <MobileNav active={active} setActive={setActive} />
              </div>
              <button
                onClick={() => setShowWizard(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:scale-[1.01]"
              >
                <Plus className="h-5 w-5" /> Cadastrar novo cliente
              </button>
            </header>

            {/* Dashboard */}
            {active === "dashboard" && (
              <section className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard title="Clientes" value={summary?.totals.clients ?? 0} caption="Contas cadastradas" icon={Building2} />
                  <MetricCard title="Liberados" value={summary?.totals.released ?? 0} caption="Acesso ativo na MegaDesk" icon={ShieldCheck} />
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white">Clientes cadastrados</h3>
                      <p className="text-sm text-slate-400">Lista geral com status e acesso à MegaDesk.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {clients.length === 0 ? (
                      <EmptyState text="Nenhum cliente cadastrado ainda. Clique em Cadastrar novo cliente para iniciar." />
                    ) : (
                      clients.map((client: any) => (
                        <article
                          key={client.id}
                          onClick={() => setSelectedClient(client)}
                          className="cursor-pointer rounded-3xl border border-white/10 bg-white/[.03] p-5 transition hover:border-cyan-400/40"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="text-lg font-semibold text-white">{client.company}</h4>
                              <p className="mt-1 text-sm text-slate-400">
                                {client.contact} • {client.phone}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-3 py-1 text-xs",
                                client.accessReleased && client.status === "active"
                                  ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                                  : "border border-amber-300/30 bg-amber-300/10 text-amber-200",
                              )}
                            >
                              {client.accessReleased && client.status === "active" ? "Ativo" : client.status}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3 text-sm text-slate-400 sm:grid-cols-3">
                            <span>Plano: <strong className="text-slate-200">{client.plan}</strong></span>
                            <span>Usuários: <strong className="text-slate-200">{client.users?.length ?? 0}</strong></span>
                            <span>Módulos: <strong className="text-slate-200">{client.modules?.length ?? 0}</strong></span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                {/* Audit log */}
                {(summary?.auditLogs ?? []).length > 0 && (
                  <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
                    <h3 className="mb-4 text-xl font-semibold text-white">Log de auditoria</h3>
                    <div className="space-y-2">
                      {(summary?.auditLogs ?? []).slice(0, 8).map((log: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.02] px-4 py-3 text-sm">
                          <span className={cn("h-2 w-2 rounded-full", log.success ? "bg-emerald-400" : "bg-red-400")} />
                          <span className="text-slate-300">{log.action}</span>
                          <span className="ml-auto text-xs text-slate-500">{log.platform}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Clients */}
            {active === "clients" && !selectedClient && (
              <section className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold text-white">Gerenciamento de clientes</h3>
                  <span className="text-xs text-slate-400">{clients.length} cliente(s)</span>
                </div>
                <p className="text-sm text-slate-400 mb-6">Clique em um cliente para editar dados, usuários, permissões e integrações.</p>
                {/* Tabela de controle de usuários */}
                {clients.length > 0 && (
                  <div className="mb-6 overflow-x-auto rounded-2xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[.03]">
                          <th className="px-4 py-3 text-left text-xs text-slate-400 font-medium">Cliente</th>
                          <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium">Usuários liberados</th>
                          <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium">Cadastrados</th>
                          <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium">Ativos</th>
                          <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium">Status</th>
                          <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium">IA Gemini</th>
                          <th className="px-4 py-3 text-right text-xs text-slate-400 font-medium">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clients.map((client: any) => {
                          const totalUsers = client.users?.length ?? 0;
                          const activeUsers = (client.users ?? []).filter((u: any) => u.status === "active").length;
                          const maxUsers = client.maxUsers ?? 5;
                          const limitReached = totalUsers >= maxUsers;
                          return (
                            <tr key={client.id} className="border-b border-white/5 hover:bg-white/[.02] transition">
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium text-white">{client.company}</p>
                                  <p className="text-xs text-slate-400">{client.plan}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-white font-semibold">{maxUsers}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={cn("font-medium", limitReached ? "text-red-400" : "text-slate-300")}>{totalUsers}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className={cn("h-2 w-2 rounded-full", activeUsers > 0 ? "bg-emerald-400" : "bg-slate-600")} />
                                  <span className="text-slate-300">{activeUsers}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", client.statusType === "active" ? "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20" : "bg-yellow-400/10 text-yellow-300 border border-yellow-400/20")}>
                                  {client.statusType === "active" ? "Ativo" : "Teste"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {client.iaStatus === "ativa" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-400/10 px-2.5 py-0.5 text-xs font-medium text-purple-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                                    IA Ativa
                                  </span>
                                ) : client.iaStatus === "quota_atingida" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-0.5 text-xs font-medium text-red-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                    Quota Atingida
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/40 bg-slate-800/40 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                                    IA Inativa
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => setSelectedClient(client)}
                                    className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40 transition"
                                  >
                                    Editar
                                  </button>
                                  <DeleteClientButton client={client} onSuccess={() => { summaryQuery.refetch(); setSelectedClient(null); }} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {clients.length === 0 && <EmptyState text="Nenhum cliente cadastrado." />}
              </section>
            )}
            {/* Client Edit Page - inline, no modal */}
            {active === "clients" && selectedClient && (
              <ClientEditPage
                client={selectedClient}
                onBack={() => setSelectedClient(null)}
                onRefresh={() => {
                  refresh();
                  summaryQuery.refetch().then((res) => {
                    if (res.data) {
                      const updated = res.data.clients.find((c: any) => c.clientId === selectedClient.clientId);
                      if (updated) setSelectedClient(updated);
                    }
                  });
                }}
              />
            )}

            {/* Users */}
            {active === "users" && (
              <section className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
                <h3 className="text-xl font-semibold text-white">Todos os usuários</h3>
                <p className="mt-2 text-sm text-slate-400">Usuários vinculados a cada cliente. Clique no cliente para editar.</p>
                <div className="mt-6 space-y-3">
                  {clients.length === 0 ? (
                    <EmptyState text="Nenhum cliente cadastrado ainda." />
                  ) : (
                    clients.flatMap((client: any) =>
                      (client.users ?? []).map((user: any) => (
                        <div
                          key={user.id}
                          className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[.03] p-5 lg:flex-row lg:items-center lg:justify-between"
                        >
                          <div>
                            <h4 className="font-semibold text-white">{user.name}</h4>
                            <p className="text-sm text-slate-400">
                              {user.email} • {client.company} •{" "}
                              <span className="text-slate-300">{user.role}</span> •{" "}
                              <span className={user.status === "active" ? "text-emerald-300" : "text-red-300"}>
                                {user.status}
                              </span>
                            </p>
                          </div>
                          <button
                            onClick={() => { setSelectedClient(client); setActive("clients"); }}
                            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:border-cyan-400/40"
                          >
                            <Settings className="mr-2 inline h-4 w-4" />
                            Gerenciar
                          </button>
                        </div>
                      )),
                    )
                  )}
                </div>
              </section>
            )}

            {/* Admins */}
            {active === "admins" && (
              <AdminsSection currentUserEmail={user.email ?? ""} />
            )}
            {/* Backups */}
            {active === "backups" && (
              <BackupsSection />
            )}
          </main>
        </div>

        {/* Modals */}
        {showWizard && (
          <ClientWizard onClose={() => setShowWizard(false)} onCreated={() => { summaryQuery.refetch(); setActive("clients"); setShowWizard(false); }} />
        )}

      </div>
    </DarkModeWrapper>
  );
}


/**
 * Backups Management Section
 */
function BackupsSection() {
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const backupsQuery = trpc.megaadmin.listBackups.useQuery();
  const createBackupMutation = trpc.megaadmin.createBackup.useMutation();
  const restoreBackupMutation = trpc.megaadmin.restoreBackup.useMutation();
  const backupInfoQuery = trpc.megaadmin.getBackupInfo.useQuery(
    { backupId: selectedBackup || "" },
    { enabled: !!selectedBackup }
  );

  const handleCreateBackup = async () => {
    try {
      await createBackupMutation.mutateAsync();
      toast.success("Backup criado com sucesso!");
      backupsQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao criar backup");
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!confirm("Tem certeza que deseja restaurar este backup? Todos os dados atuais serão sobrescritos.")) {
      return;
    }
    try {
      await restoreBackupMutation.mutateAsync({ backupId });
      toast.success("Backup restaurado com sucesso!");
      backupsQuery.refetch();
      setSelectedBackup(null);
    } catch (error: any) {
      toast.error(error?.message || "Erro ao restaurar backup");
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Backups</h2>
          <p className="text-sm text-gray-400 mt-1">Gerenciar snapshots diários de dados de clientes</p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={createBackupMutation.isPending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors"
        >
          {createBackupMutation.isPending ? "Criando..." : "+ Criar Backup Manual"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Backups List */}
        <div className="lg:col-span-2 bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h3 className="font-semibold text-white">Histórico de Backups</h3>
          </div>
          <div className="divide-y divide-gray-800 max-h-96 overflow-y-auto">
            {backupsQuery.data?.backups && backupsQuery.data.backups.length > 0 ? (
              backupsQuery.data.backups.map((backup: any) => (
                <div
                  key={backup.backupId}
                  onClick={() => setSelectedBackup(backup.backupId)}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedBackup === backup.backupId
                      ? "bg-blue-900/30 border-l-2 border-blue-500"
                      : "hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white text-sm">{backup.backupDate}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {backup.totalClients} clientes • {backup.totalConversations} conversas • {backup.totalTickets} chamados
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        backup.status === "success"
                          ? "bg-green-900/30 text-green-400"
                          : backup.status === "failed"
                          ? "bg-red-900/30 text-red-400"
                          : "bg-yellow-900/30 text-yellow-400"
                      }`}
                    >
                      {backup.status === "success" ? "✓ OK" : backup.status === "failed" ? "✗ Erro" : "⚠ Parcial"}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-400">
                <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Nenhum backup disponível</p>
              </div>
            )}
          </div>
        </div>

        {/* Backup Details */}
        {selectedBackup && backupInfoQuery.data && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
            <div>
              <h3 className="font-semibold text-white mb-3">Detalhes do Backup</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-400">ID</p>
                  <p className="text-white font-mono text-xs break-all">{backupInfoQuery.data.backupId}</p>
                </div>
                <div>
                  <p className="text-gray-400">Data</p>
                  <p className="text-white">{backupInfoQuery.data.backupDate}</p>
                </div>
                <div>
                  <p className="text-gray-400">Hora</p>
                  <p className="text-white">{new Date(backupInfoQuery.data.backupTimestamp).toLocaleTimeString()}</p>
                </div>
                <div>
                  <p className="text-gray-400">Status</p>
                  <p
                    className={`font-medium ${
                      backupInfoQuery.data.status === "success"
                        ? "text-green-400"
                        : backupInfoQuery.data.status === "failed"
                        ? "text-red-400"
                        : "text-yellow-400"
                    }`}
                  >
                    {backupInfoQuery.data.status === "success" ? "✓ Sucesso" : backupInfoQuery.data.status === "failed" ? "✗ Falha" : "⚠ Parcial"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Clientes</p>
                  <p className="text-white">{backupInfoQuery.data.totalClients}</p>
                </div>
                <div>
                  <p className="text-gray-400">Conversas</p>
                  <p className="text-white">{backupInfoQuery.data.totalConversations}</p>
                </div>
                <div>
                  <p className="text-gray-400">Chamados</p>
                  <p className="text-white">{backupInfoQuery.data.totalTickets}</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => handleRestoreBackup(selectedBackup)}
              disabled={restoreBackupMutation.isPending}
              className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors text-sm"
            >
              {restoreBackupMutation.isPending ? "Restaurando..." : "Restaurar Backup"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
