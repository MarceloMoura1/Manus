import React from "react";
import {
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileDown,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeContactPhone, formatContactPhone } from "../../../../shared/contact-phone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface QuoteActionCenterProps {
  order: any;
  canWrite: boolean;
  onRefresh?: () => void;
}

export function QuoteActionCenter({ order, canWrite, onRefresh }: QuoteActionCenterProps) {
  const isQuote = order.documentType === "quote";
  const utils = trpc.useUtils();

  // Custom document name state
  const defaultSuggestedName = `Orçamento - ${order.customerName} - ${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}`;
  const [customName, setCustomName] = React.useState<string>(
    order.documentCustomName || defaultSuggestedName
  );
  const [isEditingName, setIsEditingName] = React.useState(false);

  // Vehicle / Service drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const existingMeta = order.serviceMetadata || {};
  const [brandModel, setBrandModel] = React.useState(existingMeta.brandModel || "");
  const [plate, setPlate] = React.useState(existingMeta.plate || "");
  const [year, setYear] = React.useState(existingMeta.year || "");
  const [color, setColor] = React.useState(existingMeta.color || "");
  const [km, setKm] = React.useState(existingMeta.km || "");
  const [entryDate, setEntryDate] = React.useState(existingMeta.entryDate || "");
  const [exitDate, setExitDate] = React.useState(existingMeta.exitDate || "");

  // Update local states if order prop changes
  React.useEffect(() => {
    if (order.documentCustomName) setCustomName(order.documentCustomName);
    const meta = order.serviceMetadata || {};
    setBrandModel(meta.brandModel || "");
    setPlate(meta.plate || "");
    setYear(meta.year || "");
    setColor(meta.color || "");
    setKm(meta.km || "");
    setEntryDate(meta.entryDate || "");
    setExitDate(meta.exitDate || "");
  }, [order.publicId, order.documentCustomName, order.serviceMetadata]);

  // Template state
  const templatesQuery = trpc.crm.proposals.listTemplates.useQuery(undefined, {
    enabled: isQuote,
  });
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("");
  const [newTemplateModalOpen, setNewTemplateModalOpen] = React.useState(false);
  const [newTemplateName, setNewTemplateName] = React.useState("");
  const [newTemplateNiche, setNewTemplateNiche] = React.useState<"automotive" | "services" | "general">("automotive");
  const [newTemplateFileBase64, setNewTemplateFileBase64] = React.useState<string | null>(null);
  const [newTemplateMimeType, setNewTemplateMimeType] = React.useState<string | null>(null);
  const [newTemplateIsDefault, setNewTemplateIsDefault] = React.useState(false);

  // Set default selected template when loaded
  React.useEffect(() => {
    if (templatesQuery.data && templatesQuery.data.length > 0 && !selectedTemplateId) {
      const def = templatesQuery.data.find(t => t.isDefault) || templatesQuery.data[0];
      setSelectedTemplateId(def.publicId);
    }
  }, [templatesQuery.data, selectedTemplateId]);

  // Mutations
  const updateMetaMutation = trpc.crm.proposals.updateMetadata.useMutation({
    onSuccess: async () => {
      await utils.erp.sales.detail.invalidate({ publicId: order.publicId });
      onRefresh?.();
    },
  });

  const createTemplateMutation = trpc.crm.proposals.createTemplate.useMutation({
    onSuccess: async (res) => {
      toast.success("Modelo de orçamento cadastrado com sucesso!");
      await utils.crm.proposals.listTemplates.invalidate();
      await templatesQuery.refetch();
      setSelectedTemplateId(res.publicId);
      setNewTemplateModalOpen(false);
      setNewTemplateName("");
      setNewTemplateFileBase64(null);
      setNewTemplateMimeType(null);
      setNewTemplateIsDefault(false);
    },
    onError: (err) => {
      toast.error(`Falha ao cadastrar modelo: ${err.message}`);
    },
  });

  const generatePdfMutation = trpc.erp.sales.documents.generateQuotePdf.useMutation({
    onSuccess: async () => {
      toast.success("PDF do orçamento gerado com sucesso!");
      await utils.erp.sales.documents.list.invalidate({ salePublicId: order.publicId });
      await utils.erp.sales.detail.invalidate({ publicId: order.publicId });
      onRefresh?.();
    },
    onError: (err) => {
      toast.error(`Erro ao gerar PDF: ${err.message}`);
    },
  });

  // Client query to prefill WhatsApp phone if missing from order snapshot
  const clientQuery = trpc.crm.getById.useQuery(
    { crmClientId: order.crmClientId },
    { enabled: Boolean(order.crmClientId && isQuote) }
  );

  // Preview Modal state
  const [previewModalOpen, setPreviewModalOpen] = React.useState(false);
  const [previewPageIndex, setPreviewPageIndex] = React.useState(0);
  const previewQuery = trpc.crm.proposals.previewQuoteHtml.useQuery(
    {
      salePublicId: order.publicId,
      templatePublicId: selectedTemplateId || undefined,
    },
    {
      enabled: previewModalOpen && isQuote,
    }
  );

  // WhatsApp Dispatch Modal state
  const [whatsappModalOpen, setWhatsappModalOpen] = React.useState(false);
  const [whatsappPhone, setWhatsappPhone] = React.useState("");
  const [whatsappCustomMessage, setWhatsappCustomMessage] = React.useState("");
  const [whatsappFeedback, setWhatsappFeedback] = React.useState<string | null>(null);

  // When opening whatsapp modal, prefill canonical phone
  const openWhatsAppModal = () => {
    const raw =
      order.customerPhone ||
      order.crmClientPhone ||
      clientQuery.data?.client?.whatsapp ||
      clientQuery.data?.client?.mobilePhone ||
      clientQuery.data?.client?.phone ||
      order.shippingAddress?.phone ||
      order.billingAddress?.phone ||
      "";

    const norm = normalizeContactPhone(raw);
    const displayPhone = norm.status === "valid" ? formatContactPhone(norm.value) : raw;
    setWhatsappPhone(displayPhone);
    setWhatsappCustomMessage(
      `Olá, ${order.customerName}! Segue em anexo o orçamento comercial ${order.orderNumber} no valor de R$ ${(order.totalCents / 100).toFixed(2).replace(".", ",")}. Ficamos à disposição!`
    );
    setWhatsappFeedback(null);
    setWhatsappModalOpen(true);
  };

  const sendWhatsAppMutation = trpc.crm.proposals.sendQuoteWhatsApp.useMutation({
    onSuccess: (data) => {
      toast.success(`Orçamento enviado para ${data.recipientPhone}!`);
      setWhatsappFeedback(`Orçamento enviado com sucesso para ${data.recipientPhone}!`);
      setTimeout(() => {
        setWhatsappModalOpen(false);
        setWhatsappFeedback(null);
      }, 2500);
      utils.erp.sales.detail.invalidate({ publicId: order.publicId });
      onRefresh?.();
    },
    onError: (err) => {
      toast.error(`Erro no disparo WhatsApp: ${err.message}`);
      setWhatsappFeedback(`Erro: ${err.message}`);
    },
  });

  // Handle vehicle metadata save
  const handleSaveMetadata = async () => {
    const meta: Record<string, any> = {
      brandModel: brandModel.trim() || null,
      plate: plate.trim() || null,
      year: year.trim() || null,
      color: color.trim() || null,
      km: km.trim() || null,
      entryDate: entryDate || null,
      exitDate: exitDate || null,
    };
    await updateMetaMutation.mutateAsync({
      publicId: order.publicId,
      documentCustomName: customName.trim() || defaultSuggestedName,
      serviceMetadata: meta,
    });
    setIsEditingName(false);
  };

  // Handle template file upload with MIME sanitization and size check
  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Formato inválido. Selecione apenas imagens PNG ou JPEG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem excede o limite máximo permitido de 5MB.");
      return;
    }
    setNewTemplateMimeType(file.type);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setNewTemplateFileBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  if (!isQuote) return null;

  const hasVehicleData = Boolean(brandModel || plate || year || km);
  const validatedPhone = normalizeContactPhone(whatsappPhone);

  return (
    <div className="space-y-3" data-testid="crm-quote-action-center">
      {/* ─── PRIMARY ACTION BUTTONS BAR ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Live Preview Button */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-violet-200 bg-violet-50 text-violet-800 shadow-sm hover:bg-violet-100 hover:text-violet-900 focus-visible:ring-violet-500 active:translate-y-px motion-reduce:transition-none dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/60"
          onClick={() => {
            setPreviewPageIndex(0);
            setPreviewModalOpen(true);
          }}
          data-testid="quote-preview-btn"
        >
          <Eye className="mr-1.5 h-4 w-4 text-violet-600 dark:text-violet-400" />
          Ver Prévia
        </Button>

        {/* Generate PDF Button */}
        {canWrite && (
          <Button
            type="button"
            size="sm"
            disabled={generatePdfMutation.isPending}
            className="bg-blue-700 text-white shadow-sm hover:bg-blue-800 focus-visible:ring-blue-500 active:translate-y-px motion-reduce:transition-none dark:bg-blue-600 dark:hover:bg-blue-700"
            onClick={() =>
              generatePdfMutation.mutate({
                salePublicId: order.publicId,
                idempotencyKey: crypto.randomUUID(),
                templatePublicId: selectedTemplateId || undefined,
              })
            }
            data-testid="quote-generate-pdf-btn"
          >
            {generatePdfMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-1.5 h-4 w-4" />
            )}
            {generatePdfMutation.isPending ? "Gerando PDF…" : "Gerar PDF"}
          </Button>
        )}

        {/* Enviar WhatsApp Button */}
        {canWrite && (
          <Button
            type="button"
            size="sm"
            className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-500 active:translate-y-px motion-reduce:transition-none dark:bg-emerald-600 dark:hover:bg-emerald-700"
            onClick={openWhatsAppModal}
            data-testid="quote-send-whatsapp-btn"
          >
            <Share2 className="mr-1.5 h-4 w-4" />
            Enviar WhatsApp
          </Button>
        )}
      </div>

      {/* ─── DOCUMENT NAME & TEMPLATE CONTROLS ──────────────────────────────── */}
      <div className="grid gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] dark:border-slate-800 dark:bg-slate-800/40">
        {/* Document Custom Name */}
        <div className="flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-slate-500 text-[10px] dark:text-slate-400">
              Nome do Arquivo PDF
            </span>
            {!isEditingName ? (
              <button
                type="button"
                className="text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
                onClick={() => setIsEditingName(true)}
              >
                Editar
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  onClick={() => setCustomName(defaultSuggestedName)}
                >
                  Sugerir
                </button>
                <button
                  type="button"
                  className="font-semibold text-emerald-700 hover:underline text-[10px] dark:text-emerald-400"
                  onClick={handleSaveMetadata}
                >
                  Salvar
                </button>
              </div>
            )}
          </div>
          {isEditingName ? (
            <div className="mt-1 flex items-center gap-1.5">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Ex: Orçamento - João Silva - 21-10"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => setIsEditingName(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <span className="mt-0.5 truncate font-medium text-slate-800 text-[12px] dark:text-slate-200" title={customName}>
              {customName}.pdf
            </span>
          )}
        </div>

        {/* Template Selector Dropdown */}
        <div className="flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-slate-500 text-[10px] dark:text-slate-400">
              Modelo Visual (Template)
            </span>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
              onClick={() => setNewTemplateModalOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Novo Modelo
            </button>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              data-testid="quote-template-selector"
            >
              <option value="">Modelo Padrão MegaDesk</option>
              {templatesQuery.data?.map((tpl) => (
                <option key={tpl.publicId} value={tpl.publicId}>
                  {tpl.name} {tpl.isDefault ? "★ (Padrão)" : ""} ({tpl.niche})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ─── CONTEXTUAL VEHICLE / OBJECT DRAWER ─────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
          data-testid="quote-vehicle-drawer-toggle"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
              <Car className="h-3.5 w-3.5" />
            </div>
            <strong className="text-slate-900 font-semibold dark:text-slate-100">
              Dados do Veículo / Objeto (Nicho Automotivo & Serviços)
            </strong>
            {hasVehicleData && !drawerOpen && (
              <span className="truncate rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800 text-[11px] dark:bg-amber-950/60 dark:text-amber-300">
                {[brandModel, plate, year, km ? `${km} km` : ""].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-slate-400">
            <span className="text-[11px] font-medium">{drawerOpen ? "Recolher" : "Preencher"}</span>
            {drawerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>

        {drawerOpen && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Marca / Modelo
                </label>
                <Input
                  value={brandModel}
                  onChange={(e) => setBrandModel(e.target.value)}
                  placeholder="Ex: Toyota Corolla XEi"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Placa
                </label>
                <Input
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="Ex: ABC-1234"
                  className="mt-1 h-8 text-xs uppercase"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Ano
                </label>
                <Input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Ex: 2022"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Cor
                </label>
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Ex: Prata"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Quilometragem (KM)
                </label>
                <Input
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  placeholder="Ex: 45.000"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Data de Entrada
                </label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Previsão de Saída
                </label>
                <Input
                  type="date"
                  value={exitDate}
                  onChange={(e) => setExitDate(e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveMetadata}
                  disabled={updateMetaMutation.isPending}
                  className="h-8 w-full bg-blue-600 text-white hover:bg-blue-700 text-xs"
                >
                  {updateMetaMutation.isPending ? "Salvando…" : "Salvar Dados"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL "VER PRÉVIA" (A4 LIVE PREVIEW) ──────────────────────────── */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="flex h-[92vh] max-w-4xl flex-col gap-0 p-0 overflow-hidden bg-slate-100 dark:bg-slate-950">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                Prévia do Orçamento A4
              </DialogTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Visualização em tempo real do documento impresso / PDF final
              </p>
            </div>
            {/* Pagination Controls when > 9 items */}
            {previewQuery.data && previewQuery.data.totalPages > 1 && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={previewPageIndex === 0}
                  onClick={() => setPreviewPageIndex(0)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Página {previewPageIndex + 1} de {previewQuery.data.totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={previewPageIndex === previewQuery.data.totalPages - 1}
                  onClick={() => setPreviewPageIndex(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </DialogHeader>

          {/* Sheet Canvas Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex justify-center [scrollbar-width:thin]">
            {previewQuery.isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <span className="mt-2 text-sm font-medium">Renderizando documento A4…</span>
              </div>
            ) : previewQuery.isError ? (
              <div className="flex flex-col items-center justify-center py-20 text-rose-600">
                <p className="text-sm font-semibold">Falha ao carregar prévia do documento.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => previewQuery.refetch()}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Tentar novamente
                </Button>
              </div>
            ) : previewQuery.data?.pages?.[previewPageIndex] ? (
              <div
                className="w-full max-w-[210mm] shadow-2xl rounded-sm overflow-hidden border border-slate-300 bg-white"
                dangerouslySetInnerHTML={{
                  __html: previewQuery.data.pages[previewPageIndex].html,
                }}
              />
            ) : null}
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Arquivo: <strong>{previewQuery.data?.documentCustomName || customName}.pdf</strong>
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => {
                  window.open(`/api/erp/sales/${order.publicId}/pdf`, "_blank");
                }}
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Baixar PDF
              </Button>
              <Button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 rounded-lg px-4 py-2 text-xs shadow-none transition"
              >
                Fechar
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-5 py-2 text-xs shadow-sm transition"
                onClick={() => {
                  setPreviewModalOpen(false);
                  openWhatsAppModal();
                }}
              >
                <Share2 className="mr-1.5 h-3.5 w-3.5" />
                Disparar WhatsApp
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL DISPARO WHATSAPP ────────────────────────────────────────── */}
      <Dialog open={whatsappModalOpen} onOpenChange={setWhatsappModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Share2 className="h-5 w-5 text-emerald-600" />
              Enviar Orçamento via WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {whatsappFeedback && (
              <div
                className={cn(
                  "rounded-lg p-3 font-medium",
                  whatsappFeedback.startsWith("Erro")
                    ? "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                    : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                )}
              >
                {whatsappFeedback}
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Número do WhatsApp de Destino (com DDD)
              </label>
              <Input
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="Ex: (11) 98888-7777"
                className="mt-1 h-9"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {validatedPhone.status === "valid" ? (
                  <span className="font-semibold text-emerald-600">
                    ✓ Número canônico: {formatContactPhone(validatedPhone.value)}
                  </span>
                ) : (
                  <span className="text-amber-600">
                    Informe DDD e telefone com 10 ou 11 dígitos.
                  </span>
                )}
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Documento Anexado (PDF)
              </label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
                <FileText className="h-5 w-5 text-blue-600" />
                <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                  {customName}.pdf
                </span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Mensagem que Acompanha o Documento
              </label>
              <textarea
                value={whatsappCustomMessage}
                onChange={(e) => setWhatsappCustomMessage(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/60">
            <Button
              type="button"
              disabled={sendWhatsAppMutation.isPending}
              onClick={() => setWhatsappModalOpen(false)}
              className="bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 rounded-lg px-4 py-2 text-xs shadow-none transition"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={validatedPhone.status !== "valid" || sendWhatsAppMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-5 py-2 text-xs shadow-sm transition disabled:opacity-50"
              onClick={() =>
                sendWhatsAppMutation.mutate({
                  publicId: order.publicId,
                  phone: validatedPhone.status === "valid" ? validatedPhone.value : undefined,
                  customMessage: whatsappCustomMessage,
                  templatePublicId: selectedTemplateId || undefined,
                })
              }
            >
              {sendWhatsAppMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Disparando…
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Confirmar e Enviar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL NOVO TEMPLATE BASE ──────────────────────────────────────── */}
      <Dialog open={newTemplateModalOpen} onOpenChange={setNewTemplateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Novo Modelo de Orçamento Base
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Nome do Modelo
              </label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="Ex: Base Prestação de Serviços, Venda Balcão"
                className="mt-1 h-8"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Nicho de Atuação
              </label>
              <select
                value={newTemplateNiche}
                onChange={(e) => setNewTemplateNiche(e.target.value as any)}
                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="automotive">Automotivo (Oficinas, Funilaria, Peças)</option>
                <option value="services">Prestação de Serviços Gerais</option>
                <option value="general">Comércio Geral / Venda Balcão</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Imagem Base / Papel Timbrado (PNG ou JPG)
              </label>
              <div className="mt-1 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-4 dark:border-slate-700">
                {newTemplateFileBase64 ? (
                  <div className="flex flex-col items-center">
                    <img
                      src={newTemplateFileBase64}
                      alt="Prévia do modelo"
                      className="max-h-28 rounded object-contain shadow-sm"
                    />
                    <button
                      type="button"
                      className="mt-2 text-rose-600 hover:underline text-[11px]"
                      onClick={() => setNewTemplateFileBase64(null)}
                    >
                      Remover imagem
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center cursor-pointer">
                    <UploadCloud className="h-6 w-6 text-slate-400" />
                    <span className="mt-1 font-medium text-blue-600 hover:underline">
                      Selecionar imagem PNG/JPG
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleTemplateFileChange}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="templateDefault"
                checked={newTemplateIsDefault}
                onChange={(e) => setNewTemplateIsDefault(e.target.checked)}
                className="rounded border-slate-300"
              />
              <label htmlFor="templateDefault" className="text-slate-700 font-medium dark:text-slate-300">
                Definir como modelo padrão para novos orçamentos
              </label>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/60">
            <Button
              type="button"
              disabled={createTemplateMutation.isPending}
              onClick={() => setNewTemplateModalOpen(false)}
              className="bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 rounded-lg px-4 py-2 text-xs shadow-none transition"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!newTemplateName.trim() || createTemplateMutation.isPending}
              onClick={() =>
                createTemplateMutation.mutate({
                  name: newTemplateName.trim(),
                  niche: newTemplateNiche,
                  fileBase64: newTemplateFileBase64,
                  mimeType: newTemplateMimeType || undefined,
                  isDefault: newTemplateIsDefault,
                })
              }
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-5 py-2 text-xs shadow-sm transition disabled:opacity-50"
            >
              {createTemplateMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Cadastrando…
                </>
              ) : (
                "Cadastrar Modelo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
