/**
 * WhatsAppConfigPage — Configuração de contas WhatsApp Business por cliente.
 * Cada cliente pode conectar múltiplos números da Meta (Phone Number ID, Business Account ID, Access Token).
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Smartphone,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  ExternalLink,
  RefreshCw,
  Info,
} from "lucide-react";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface WaAccount {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  phoneNumberId: string;
  businessAccountId: string;
  status: "active" | "inactive" | "error";
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface AccountFormData {
  displayName: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
}

const EMPTY_FORM: AccountFormData = {
  displayName: "",
  phoneNumberId: "",
  businessAccountId: "",
  accessToken: "",
  webhookVerifyToken: "",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function WhatsAppConfigPage() {
  const session = JSON.parse(localStorage.getItem("megadesk_session_v1") || "{}");
  const clientId: string = session?.clientId ?? "";

  const [showAddModal, setShowAddModal] = useState(false);
  const [editAccount, setEditAccount] = useState<WaAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WaAccount | null>(null);
  const [form, setForm] = useState<AccountFormData>(EMPTY_FORM);
  const [showToken, setShowToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const {
    data: accounts,
    isLoading,
    refetch,
  } = trpc.whatsapp.listAccounts.useQuery(
    { clientId },
    { enabled: !!clientId, refetchInterval: 30_000 }
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const connectMut = trpc.whatsapp.connectAccount.useMutation({
    onSuccess: () => {
      toast.success("Conta WhatsApp conectada com sucesso!");
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      refetch();
    },
    onError: (e) => setFormError(e.message),
  });

  const updateMut = trpc.whatsapp.updateAccount.useMutation({
    onSuccess: () => {
      toast.success("Conta atualizada com sucesso!");
      setEditAccount(null);
      setForm(EMPTY_FORM);
      refetch();
    },
    onError: (e) => setFormError(e.message),
  });

  const disconnectMut = trpc.whatsapp.disconnectAccount.useMutation({
    onSuccess: () => {
      toast.success("Conta desativada.");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMut = trpc.whatsapp.removeAccount.useMutation({
    onSuccess: () => {
      toast.success("Conta removida com sucesso.");
      setDeleteTarget(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowToken(false);
    setShowWebhookToken(false);
    setShowAddModal(true);
  }

  function openEdit(acc: WaAccount) {
    setForm({
      displayName: acc.displayName,
      phoneNumberId: acc.phoneNumberId,
      businessAccountId: acc.businessAccountId,
      accessToken: "",
      webhookVerifyToken: "",
    });
    setFormError(null);
    setShowToken(false);
    setShowWebhookToken(false);
    setEditAccount(acc);
  }

  function handleSubmitAdd() {
    setFormError(null);
    if (!form.displayName.trim()) return setFormError("Nome da conta é obrigatório.");
    if (!form.phoneNumberId.trim()) return setFormError("Phone Number ID é obrigatório.");
    if (!form.businessAccountId.trim()) return setFormError("Business Account ID é obrigatório.");
    if (!form.accessToken.trim()) return setFormError("Access Token é obrigatório.");
    connectMut.mutate({
      clientId,
      displayName: form.displayName.trim(),
      phoneNumberId: form.phoneNumberId.trim(),
      businessAccountId: form.businessAccountId.trim(),
      accessToken: form.accessToken.trim(),
      webhookVerifyToken: form.webhookVerifyToken.trim() || undefined,
    });
  }

  function handleSubmitEdit() {
    if (!editAccount) return;
    setFormError(null);
    if (!form.displayName.trim()) return setFormError("Nome da conta é obrigatório.");
    updateMut.mutate({
      clientId,
      accountId: editAccount.id,
      displayName: form.displayName.trim(),
      ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
    });
  }

  function handleToggle(acc: WaAccount) {
    if (acc.status === "active") {
      disconnectMut.mutate({ clientId, accountId: acc.id });
    } else {
      // Reativar: usar updateAccount com status active
      updateMut.mutate({ clientId, accountId: acc.id, status: "active" });
    }
  }

  function copyWebhookUrl() {
    const url = `${window.location.origin}/api/webhooks/meta`;
    navigator.clipboard.writeText(url).then(() => toast.success("URL copiada!"));
  }

  // ─── Helpers visuais ─────────────────────────────────────────────────────────

  function StatusBadge({ status }: { status: WaAccount["status"] }) {
    if (status === "active")
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
          <CheckCircle2 className="w-3 h-3" /> Ativo
        </Badge>
      );
    if (status === "error")
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
          <XCircle className="w-3 h-3" /> Erro
        </Badge>
      );
    return (
      <Badge className="bg-slate-100 text-slate-600 border-slate-200 gap-1">
        <AlertCircle className="w-3 h-3" /> Inativo
      </Badge>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-600" />
            Configuração WhatsApp
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Conecte seus números WhatsApp Business via Meta Cloud API.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4" />
          Adicionar conta
        </Button>
      </div>

      {/* Webhook info */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-800">URL do Webhook Meta</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Configure esta URL no painel da Meta para receber mensagens em tempo real.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <code className="text-xs bg-white border border-blue-200 rounded px-2 py-1 text-blue-700 font-mono truncate flex-1">
              {window.location.origin}/api/webhooks/meta
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyWebhookUrl}
              className="flex-shrink-0 gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
            >
              <Copy className="w-3 h-3" /> Copiar
            </Button>
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                <ExternalLink className="w-3 h-3" /> Meta
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Lista de contas */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando contas...
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <Smartphone className="w-12 h-12 opacity-30" />
          <p className="text-sm font-medium">Nenhuma conta conectada</p>
          <p className="text-xs text-center max-w-xs">
            Clique em "Adicionar conta" para conectar seu primeiro número WhatsApp Business.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(accounts as WaAccount[]).map((acc) => (
            <div
              key={acc.id}
              className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
            >
              {/* Ícone */}
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  acc.status === "active"
                    ? "bg-emerald-100"
                    : acc.status === "error"
                    ? "bg-red-100"
                    : "bg-slate-100"
                }`}
              >
                <Smartphone
                  className={`w-5 h-5 ${
                    acc.status === "active"
                      ? "text-emerald-600"
                      : acc.status === "error"
                      ? "text-red-500"
                      : "text-slate-400"
                  }`}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900 text-sm">{acc.displayName}</span>
                  <StatusBadge status={acc.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {acc.phoneNumber && (
                    <span className="text-xs text-slate-500">📱 {acc.phoneNumber}</span>
                  )}
                  <span className="text-xs text-slate-400 font-mono">
                    ID: {acc.phoneNumberId}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    WABA: {acc.businessAccountId}
                  </span>
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(acc)}
                  className="text-xs"
                >
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggle(acc)}
                  disabled={disconnectMut.isPending || updateMut.isPending}
                  className={`text-xs gap-1 ${
                    acc.status === "active"
                      ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  {acc.status === "active" ? (
                    <><PowerOff className="w-3 h-3" /> Desativar</>
                  ) : (
                    <><Power className="w-3 h-3" /> Ativar</>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(acc)}
                  className="text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Modal Adicionar ─────────────────────────────────────────────────── */}
      <Dialog open={showAddModal} onOpenChange={(o) => { if (!o) { setShowAddModal(false); setFormError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-emerald-600" />
              Adicionar conta WhatsApp
            </DialogTitle>
          </DialogHeader>
          <AccountForm
            form={form}
            setForm={setForm}
            showToken={showToken}
            setShowToken={setShowToken}
            showWebhookToken={showWebhookToken}
            setShowWebhookToken={setShowWebhookToken}
            error={formError}
            isLoading={connectMut.isPending}
            onSubmit={handleSubmitAdd}
            onCancel={() => { setShowAddModal(false); setFormError(null); }}
            submitLabel="Conectar conta"
          />
        </DialogContent>
      </Dialog>

      {/* ─── Modal Editar ────────────────────────────────────────────────────── */}
      <Dialog open={!!editAccount} onOpenChange={(o) => { if (!o) { setEditAccount(null); setFormError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-blue-600" />
              Editar conta — {editAccount?.displayName}
            </DialogTitle>
          </DialogHeader>
          <AccountForm
            form={form}
            setForm={setForm}
            showToken={showToken}
            setShowToken={setShowToken}
            showWebhookToken={showWebhookToken}
            setShowWebhookToken={setShowWebhookToken}
            error={formError}
            isLoading={updateMut.isPending}
            onSubmit={handleSubmitEdit}
            onCancel={() => { setEditAccount(null); setFormError(null); }}
            submitLabel="Salvar alterações"
            isEdit
          />
        </DialogContent>
      </Dialog>

      {/* ─── Confirmação de remoção ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conta WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta <strong>{deleteTarget?.displayName}</strong> será removida permanentemente.
              Todas as conversas vinculadas a este número serão mantidas, mas novos webhooks não
              serão processados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && removeMut.mutate({ clientId, accountId: deleteTarget.id })}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Formulário reutilizável ──────────────────────────────────────────────────

interface AccountFormProps {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  showWebhookToken: boolean;
  setShowWebhookToken: (v: boolean) => void;
  error: string | null;
  isLoading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  isEdit?: boolean;
}

function AccountForm({
  form,
  setForm,
  showToken,
  setShowToken,
  showWebhookToken,
  setShowWebhookToken,
  error,
  isLoading,
  onSubmit,
  onCancel,
  submitLabel,
  isEdit,
}: AccountFormProps) {
  const field = (key: keyof AccountFormData) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Nome */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Nome da conta</label>
        <Input placeholder="Ex: Suporte Principal" {...field("displayName")} />
        <p className="text-xs text-slate-400">Nome para identificar este número internamente.</p>
      </div>

      {/* Phone Number ID */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Phone Number ID</label>
        <Input
          placeholder="Ex: 123456789012345"
          {...field("phoneNumberId")}
          disabled={isEdit}
          className={isEdit ? "bg-slate-50 text-slate-400" : ""}
        />
        <p className="text-xs text-slate-400">
          Encontrado em: Meta for Developers → App → WhatsApp → API Setup → Phone Number ID.
        </p>
      </div>

      {/* Business Account ID */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Business Account ID (WABA ID)</label>
        <Input
          placeholder="Ex: 987654321098765"
          {...field("businessAccountId")}
          disabled={isEdit}
          className={isEdit ? "bg-slate-50 text-slate-400" : ""}
        />
        <p className="text-xs text-slate-400">
          Encontrado em: Meta Business Suite → Configurações → Contas WhatsApp Business.
        </p>
      </div>

      {/* Access Token */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">
          Access Token {isEdit && <span className="text-slate-400 font-normal">(deixe em branco para manter)</span>}
        </label>
        <div className="relative">
          <Input
            type={showToken ? "text" : "password"}
            placeholder={isEdit ? "Novo token (opcional)" : "EAABwzLixnjYBO..."}
            {...field("accessToken")}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Token permanente gerado no painel Meta for Developers. Nunca compartilhe este token.
        </p>
      </div>

      {/* Webhook Verify Token */}
      {!isEdit && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            Webhook Verify Token <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <div className="relative">
            <Input
              type={showWebhookToken ? "text" : "password"}
              placeholder="Token secreto para verificação do webhook"
              {...field("webhookVerifyToken")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowWebhookToken(!showWebhookToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Token que você define no painel Meta para verificar a autenticidade dos webhooks.
          </p>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Ações */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isLoading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          {isLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
