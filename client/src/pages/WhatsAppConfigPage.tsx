/**
 * WhatsAppConfigPage — Configuração de conta WhatsApp Business por cliente.
 * Admins podem conectar e gerenciar a integração WhatsApp.
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

export function WhatsAppConfigPage() {
  const session = JSON.parse(localStorage.getItem("megadesk_session_v1") || "{}");
  const clientId: string = session?.clientId ?? "";

  const [showModal, setShowModal] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    phoneNumberId: "",
    businessAccountId: "",
    accessToken: "",
    webhookVerifyToken: "",
    phoneNumber: "",
  });

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: config, isLoading, refetch } = trpc.whatsapp.getConfig.useQuery(
    { clientId },
    { enabled: !!clientId, refetchInterval: 30_000 }
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const saveMut = trpc.whatsapp.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuração WhatsApp salva com sucesso!");
      setShowModal(false);
      setForm({
        phoneNumberId: "",
        businessAccountId: "",
        accessToken: "",
        webhookVerifyToken: "",
        phoneNumber: "",
      });
      refetch();
    },
    onError: (e: any) => setFormError(e?.message || "Erro ao salvar configuração"),
  });

  const testMut = trpc.whatsapp.testConnection.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao testar conexão"),
  });

  const deleteMut = trpc.whatsapp.deleteConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuração WhatsApp removida.");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao remover configuração"),
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleSubmit() {
    setFormError(null);
    if (!form.phoneNumberId.trim()) return setFormError("Phone Number ID é obrigatório.");
    if (!form.businessAccountId.trim()) return setFormError("Business Account ID é obrigatório.");
    if (!form.accessToken.trim()) return setFormError("Access Token é obrigatório.");

    saveMut.mutate({
      clientId,
      phoneNumberId: form.phoneNumberId.trim(),
      businessAccountId: form.businessAccountId.trim(),
      accessToken: form.accessToken.trim(),
      webhookVerifyToken: form.webhookVerifyToken.trim() || "",
      phoneNumber: form.phoneNumber.trim() || "",
      webhookUrl: `${window.location.origin}/api/webhooks/meta`,
    });
  }

  function copyWebhookUrl() {
    const url = `${window.location.origin}/api/webhooks/meta`;
    navigator.clipboard.writeText(url).then(() => toast.success("URL copiada!"));
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
            Conecte seu número WhatsApp Business via Meta Cloud API.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4" />
          {config ? "Atualizar" : "Conectar"}
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

      {/* Status */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : !config ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50">
          <Smartphone className="w-12 h-12 opacity-30" />
          <p className="text-sm font-medium">Nenhuma conta conectada</p>
          <p className="text-xs text-center max-w-xs">
            Clique em "Conectar" para configurar seu número WhatsApp Business.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">WhatsApp Business</p>
                  <p className="text-sm text-slate-500">{config.phoneNumber || "Número não configurado"}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-600">Phone Number ID:</span>
                  <code className="bg-slate-100 px-2 py-1 rounded text-xs font-mono text-slate-700">
                    {config.phoneNumberId}
                  </code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-600">Business Account ID:</span>
                  <code className="bg-slate-100 px-2 py-1 rounded text-xs font-mono text-slate-700">
                    {config.businessAccountId}
                  </code>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <span className="text-slate-600">Status da conexão:</span>
                  <Badge className={config.connectionStatus ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}>
                    {config.connectionStatus ? "✓ Ativo" : "○ Inativo"}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => testMut.mutate({ clientId })}
                disabled={testMut.isPending}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Testar
              </Button>
              <Button
                onClick={() => setShowModal(true)}
                variant="outline"
                size="sm"
              >
                Editar
              </Button>
              <AlertDialog>
                <Button
                  onClick={(e) => {
                    e.preventDefault();
                    const dialog = document.querySelector('[role="alertdialog"]');
                    if (dialog) {
                      const trigger = dialog.querySelector('[role="button"]');
                      if (trigger) trigger.dispatchEvent(new Event("click"));
                    }
                  }}
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  Remover
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover configuração WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita. Você perderá a integração WhatsApp.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate({ clientId })}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Remover
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal ─────────────────────────────────────────────────────────── */}
      <Dialog open={showModal} onOpenChange={(o) => { if (!o) { setShowModal(false); setFormError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-emerald-600" />
              {config ? "Atualizar" : "Conectar"} WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone Number ID *
              </label>
              <Input
                placeholder="123456789"
                value={form.phoneNumberId}
                onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Business Account ID *
              </label>
              <Input
                placeholder="987654321"
                value={form.businessAccountId}
                onChange={(e) => setForm({ ...form, businessAccountId: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Access Token *
              </label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  placeholder="EAA..."
                  value={form.accessToken}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Webhook Verify Token
              </label>
              <div className="relative">
                <Input
                  type={showWebhookToken ? "text" : "password"}
                  placeholder="seu-token-secreto"
                  value={form.webhookVerifyToken}
                  onChange={(e) => setForm({ ...form, webhookVerifyToken: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookToken(!showWebhookToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                >
                  {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Número de Telefone (opcional)
              </label>
              <Input
                placeholder="+55 11 99999-9999"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSubmit}
                disabled={saveMut.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                {saveMut.isPending ? "Salvando..." : "Salvar"}
              </Button>
              <Button
                onClick={() => setShowModal(false)}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
