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
  LayoutTemplate,
  Loader2,
  MessageCircle,
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

const A4_WIDTH_PX = 794; // 210mm @ 96dpi
const A4_HEIGHT_PX = 1123; // 297mm @ 96dpi

/** Fits the fixed 210x297mm sheet inside the available width via proportional scale. */
function A4SheetFit({ html }: { html: string }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const update = () => {
      const available = node.clientWidth;
      if (available > 0) setScale(Math.min(1, available / A4_WIDTH_PX));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="flex w-full items-start justify-center overflow-x-hidden"
    >
      <div
        style={{ width: A4_WIDTH_PX * scale, height: A4_HEIGHT_PX * scale, maxWidth: "100%" }}
        className="shrink-0 rounded-sm border border-slate-300 bg-white shadow-2xl overflow-hidden"
      >
        <div
          style={{ width: A4_WIDTH_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

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
    toast.success("Configuração do documento salva com sucesso!");
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
  const selectedTemplate = templatesQuery.data?.find((t) => t.publicId === selectedTemplateId);

  return (
    <div className="space-y-3" data-testid="crm-quote-action-center">
      {/* ─── BLOCO 4: DADOS DO VEÍCULO / OBJETO (Nicho Automotivo & Serviços) ─── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" data-testid="quote-vehicle-block">
        <button
          type="button"
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
          data-testid="quote-vehicle-drawer-toggle"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
              <Car className="h-4 w-4" />
            </div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Dados do Veículo / Objeto
            </strong>
            <span className="text-[10px] font-medium text-slate-400">(Nicho Automotivo & Serviços)</span>

            {hasVehicleData && !drawerOpen ? (
              <div className="ml-1 flex flex-wrap items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-0.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                <span>🚗 {brandModel || "Veículo"}</span>
                {plate && (
                  <span className="rounded bg-slate-900 px-1.5 py-0.2 text-[10px] font-bold tracking-wider text-white dark:bg-slate-100 dark:text-slate-900">
                    {plate}
                  </span>
                )}
                {year && <span>· {year}</span>}
                {color && <span>· {color}</span>}
                {km && <span>· {km} km</span>}
              </div>
            ) : !drawerOpen ? (
              <span className="text-[11px] text-slate-400">Nenhum veículo vinculado · Clique para preencher</span>
            ) : null}
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
                  placeholder="Ex: Voyage G5"
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
                  placeholder="Ex: HLN-2E46"
                  className="mt-1 h-8 text-xs uppercase font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Ano
                </label>
                <Input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Ex: 2011"
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
                  placeholder="Ex: Preto"
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
                  placeholder="Ex: 120.000"
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
                  className="h-8 w-full bg-slate-900 text-white hover:bg-slate-800 text-xs dark:bg-slate-100 dark:text-slate-900"
                >
                  {updateMetaMutation.isPending ? "Salvando…" : "Salvar alterações"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── BLOCO 5: CONFIGURAÇÃO DO DOCUMENTO (Nome & Modelo Visual) ─────────────────── */}
      <div
        className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        data-testid="quote-config-block"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
          {/* Coluna 1 - Nome do Arquivo PDF */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between h-6 mb-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Nome do Arquivo PDF</span>
              </label>
              <button
                type="button"
                onClick={() => setCustomName(defaultSuggestedName)}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-medium transition-colors dark:text-indigo-400 dark:hover:text-indigo-300"
                title="Sugerir nome comercial automático"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Sugerir</span>
              </button>
            </div>
            <div className="flex items-center gap-2 h-10">
              <div className="relative flex-1 h-10">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Ex: Orçamento - João Silva - 21-10"
                  className="w-full h-10 px-3 pr-11 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold text-slate-400">
                  .pdf
                </span>
              </div>
              <Button
                type="button"
                disabled={updateMetaMutation.isPending}
                onClick={handleSaveMetadata}
                className="h-10 px-4 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm font-medium flex items-center gap-1.5 shrink-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 shadow-sm"
              >
                {updateMetaMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 text-emerald-400" />
                )}
                <span>Salvar</span>
              </Button>
            </div>
          </div>

          {/* Coluna 2 - Modelo Visual (Folha Oficial) */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between h-6 mb-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span>Modelo Visual (Folha Oficial)</span>
              </label>
              {selectedTemplate && (
                <span className="inline-flex items-center rounded-md bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-700/10 dark:bg-violet-950/60 dark:text-violet-300">
                  {selectedTemplate.niche === "automotive"
                    ? "AUTOMOTIVO"
                    : selectedTemplate.niche === "services"
                      ? "SERVIÇOS"
                      : "GERAL"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 h-10">
              <div className="relative flex-1 h-10">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full h-10 px-3 pr-8 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 appearance-none focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-200"
                  data-testid="quote-template-selector"
                >
                  <option value="">Modelo Padrão MegaDesk</option>
                  {templatesQuery.data?.map((tpl) => (
                    <option key={tpl.publicId} value={tpl.publicId}>
                      {tpl.name} {tpl.isDefault ? "★ (Padrão)" : ""} [{tpl.niche}]
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewTemplateModalOpen(true)}
                className="h-10 px-3.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200 flex items-center gap-1.5 shrink-0 bg-white dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>+ Novo Modelo</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── BLOCO 6: AÇÕES DE EMISSÃO & DISPARO (Ações Primárias Centralizadas) ──────────── */}
      <div
        className="flex flex-wrap items-center justify-center gap-3 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        data-testid="quote-emission-bar"
      >
        {/* 1. Ver Prévia */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 rounded-lg border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          onClick={() => {
            setPreviewPageIndex(0);
            setPreviewModalOpen(true);
          }}
          data-testid="quote-preview-btn"
        >
          <Eye className="mr-1.5 h-4 w-4 text-violet-600 dark:text-violet-400" />
          Ver Prévia
        </Button>

        {/* 2. Gerar PDF */}
        {canWrite && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={generatePdfMutation.isPending}
            className="h-9 rounded-lg border-blue-300 bg-blue-50 px-4 text-xs font-medium text-blue-800 shadow-sm hover:bg-blue-100 hover:text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300"
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
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-blue-600" />
            ) : (
              <FileDown className="mr-1.5 h-4 w-4 text-blue-600 dark:text-blue-400" />
            )}
            {generatePdfMutation.isPending ? "Gerando PDF…" : "Gerar PDF"}
          </Button>
        )}

        {/* 3. Enviar ao WhatsApp */}
        {canWrite && (
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-500 active:translate-y-px motion-reduce:transition-none dark:bg-emerald-600 dark:hover:bg-emerald-700"
            onClick={openWhatsAppModal}
            data-testid="quote-send-whatsapp-btn"
          >
            <MessageCircle className="mr-1.5 h-4 w-4" />
            Enviar ao WhatsApp
          </Button>
        )}
      </div>

      {/* ─── MODAL "VER PRÉVIA" (A4 LIVE PREVIEW) ──────────────────────────── */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="flex h-[92vh] w-full max-w-4xl sm:max-w-4xl flex-col gap-0 p-0 overflow-hidden bg-slate-100 dark:bg-slate-950">
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
          <div className="flex flex-1 items-start justify-center overflow-y-auto overflow-x-hidden p-3 sm:p-6 [scrollbar-width:thin]">
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
              <A4SheetFit html={previewQuery.data.pages[previewPageIndex].html} />
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
