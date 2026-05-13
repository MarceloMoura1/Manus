import { useState } from "react";
import { ShieldCheck, UserPlus, Pencil, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <ShieldCheck className="mb-3 h-10 w-10 text-slate-600" />
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function AdminsSection({ currentUserEmail }: { currentUserEmail: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.megaadmin.listAdmins.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: number; name: string; email: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [editForm, setEditForm] = useState({ name: "", password: "", active: true });
  const [formError, setFormError] = useState("");

  const createMut = trpc.megaadmin.createAdmin.useMutation({
    onSuccess: () => {
      utils.megaadmin.listAdmins.invalidate();
      setShowForm(false);
      setForm({ name: "", email: "", password: "" });
      setFormError("");
    },
    onError: (e) => setFormError(e.message),
  });
  const updateMut = trpc.megaadmin.updateAdmin.useMutation({
    onSuccess: () => {
      utils.megaadmin.listAdmins.invalidate();
      setEditTarget(null);
      setFormError("");
    },
    onError: (e) => setFormError(e.message),
  });
  const deleteMut = trpc.megaadmin.deleteAdmin.useMutation({
    onSuccess: () => utils.megaadmin.listAdmins.invalidate(),
    onError: (e) => alert(e.message),
  });

  const admins = data?.admins ?? [];

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">Administradores MegaAdmin</h3>
          <p className="mt-1 text-sm text-slate-400">Gerencie as credenciais de acesso ao painel administrativo.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(""); }}
          className="flex items-center gap-2 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30 transition"
        >
          <UserPlus className="h-4 w-4" />
          Novo administrador
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-[2rem] border border-cyan-400/20 bg-slate-900/80 p-6 space-y-4">
          <h4 className="font-semibold text-white">Cadastrar novo administrador</h4>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nome</label>
              <input
                className="w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/50 focus:outline-none"
                placeholder="Nome completo"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">E-mail</label>
              <input
                type="email"
                className="w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/50 focus:outline-none"
                placeholder="email@exemplo.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Senha (mínimo 6 caracteres)</label>
              <input
                type="password"
                className="w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/50 focus:outline-none"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              disabled={createMut.isPending}
              onClick={() => createMut.mutate(form)}
              className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400 disabled:opacity-50 transition"
            >
              {createMut.isPending ? "Salvando..." : "Cadastrar"}
            </button>
            <button
              onClick={() => { setShowForm(false); setFormError(""); }}
              className="rounded-2xl border border-white/10 px-5 py-2 text-sm text-slate-300 hover:border-white/30 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="rounded-[2rem] border border-amber-400/20 bg-slate-900/80 p-6 space-y-4">
          <h4 className="font-semibold text-white">
            Editar: <span className="text-amber-300">{editTarget.email}</span>
          </h4>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nome</label>
              <input
                className="w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-400/50 focus:outline-none"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nova senha (deixe em branco para não alterar)</label>
              <input
                type="password"
                className="w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-400/50 focus:outline-none"
                placeholder="••••••••"
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            {editTarget.email !== currentUserEmail && (
              <div className="flex items-center gap-2">
                <input
                  id="active-toggle"
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 accent-cyan-400"
                />
                <label htmlFor="active-toggle" className="text-sm text-slate-300">Conta ativa</label>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              disabled={updateMut.isPending}
              onClick={() => {
                const payload: { id: number; name?: string; password?: string; active?: boolean } = { id: editTarget.id };
                if (editForm.name) payload.name = editForm.name;
                if (editForm.password) payload.password = editForm.password;
                if (editTarget.email !== currentUserEmail) payload.active = editForm.active;
                updateMut.mutate(payload);
              }}
              className="rounded-2xl bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50 transition"
            >
              {updateMut.isPending ? "Salvando..." : "Salvar alterações"}
            </button>
            <button
              onClick={() => { setEditTarget(null); setFormError(""); }}
              className="rounded-2xl border border-white/10 px-5 py-2 text-sm text-slate-300 hover:border-white/30 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6">
        {isLoading ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : admins.length === 0 ? (
          <EmptyState text="Nenhum administrador cadastrado." />
        ) : (
          <div className="space-y-3">
            {admins.map((admin: any) => (
              <div
                key={admin.id}
                className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[.03] p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{admin.name}</p>
                    <p className="text-sm text-slate-400">{admin.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Criado em {new Date(admin.createdAt).toLocaleDateString("pt-BR")}
                      {admin.email === currentUserEmail && (
                        <span className="ml-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-cyan-300">
                          Você
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs border",
                      admin.active
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                        : "border-red-400/30 bg-red-400/10 text-red-300",
                    )}
                  >
                    {admin.active ? "Ativo" : "Inativo"}
                  </span>
                  <button
                    onClick={() => {
                      setEditTarget({ id: Number(admin.id), name: admin.name, email: admin.email });
                      setEditForm({ name: admin.name, password: "", active: admin.active });
                      setFormError("");
                    }}
                    className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-amber-400/30 transition"
                  >
                    <Pencil className="mr-1 inline h-3 w-3" />
                    Editar
                  </button>
                  {admin.email !== currentUserEmail && (
                    <button
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (confirm(`Excluir o administrador "${admin.name}"? Esta ação não pode ser desfeita.`)) {
                          deleteMut.mutate({ id: Number(admin.id) });
                        }
                      }}
                      className="rounded-xl border border-red-400/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 transition disabled:opacity-50"
                    >
                      <Trash2 className="mr-1 inline h-3 w-3" />
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
