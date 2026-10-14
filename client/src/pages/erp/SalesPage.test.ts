import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/erp/SalesPage.tsx", "utf8");

describe("ERP Vendas B+C interface", () => {
  it("uses the approved six-stage timeline as the wide detail focal point", () => {
    for (const stage of [
      '"created"',
      '"confirmed"',
      '"separation"',
      '"shipped"',
      '"received"',
      '"completed"',
    ]) {
      expect(source).toContain(stage);
    }
    expect(source).toContain("Timeline das etapas da venda");
    expect(source).toContain("grid-cols-6");
    expect(source).toContain('min-w-[640px] grid-cols-6 sm:min-w-0');
    expect(source).toContain("overflow-x-auto");
  });

  it("keeps payment independent from the operational stage", () => {
    expect(source).toContain("Pendente");
    expect(source).toContain("Pagamento parcial");
    expect(source).toContain("Pago");
    expect(source).toContain("paymentStatus");
    expect(source).toContain("currentStage");
  });

  it("shows real variant availability separately from the no-reservation policy", () => {
    expect(source).toContain("A confirmação não reserva estoque");
    expect(source).toContain("item.currentAvailable");
    expect(source).toContain("item.stockExitRecorded");
    expect(source).toContain("Saldo atual por variação");
    expect(source).toContain("saleStockPresentation({ currentAvailable: item.currentAvailable");
    expect(source).toContain("Quantidade vendida e baixa são informações separadas.");
    expect(source).not.toContain("Reserva desta venda: não aplicada.");
    expect(source).not.toContain("Reserva ativa");
    expect(source).not.toContain("Reserva registrada");
  });

  it("renders a compact list and a dedicated detail screen with historical states", () => {
    expect(source).toContain("Lista comercial");
    expect(source).toContain("SaleDetailPanel");
    expect(source).toContain("sales-detail-screen");
    expect(source).toContain("Voltar para vendas");
    expect(source).toContain("onSaleNavigate?.(publicId)");
    expect(source).toContain("formatSalesDeliveryAddress(order.shippingAddress)");
    expect(source).toContain("Parte do histórico é anterior à timeline auditada");
    expect(source).toContain("productMediaUrl");
  });

  it("exposes Delivery D manual private document controls without fiscal emission", () => {
    expect(source).not.toContain("Emitir nota fiscal");
    expect(source).toContain("Anexar documento");
    expect(source).toContain("Declaração de conteúdo");
    expect(source).toContain("Documentos privados da venda");
    expect(source).toContain("downloadUrl");
  });

  it("includes loading, empty, error, denied and responsive compositions", () => {
    expect(source).toContain("Carregando ${entityLabelPlural}");
    expect(source).toContain("Nenhum ${entityLabel} encontrado");
    expect(source).toContain("Não foi possível carregar ${entityLabelPlural}");
    expect(source).toContain("Seu perfil não tem acesso");
    expect(source).toContain('data-testid="sales-detail-facts"');
    expect(source).toContain('data-testid="sales-detail-products"');
    expect(source).toContain('data-testid="sales-detail-actions"');
    expect(source).toContain("sm:max-w-[min(96vw,1440px)]");
  });

  it("keeps customer and catalog searches incremental and variants on demand", () => {
    expect(source).toContain("Nenhum cadastro é carregado antes da busca");
    expect(source).toContain("Digite ao menos {SALES_LOOKUP_MIN_LENGTH} caracteres");
    expect(source).toContain("expandedCatalogProductId");
    expect(source).toContain("variações aparecem somente quando você abrir o resultado");
  });

  it("uses direct BRL inputs, one primary address and a guided financial check", () => {
    expect(source).toContain("<MoneyInput");
    expect(source).not.toContain('step="0.01"');
    expect(source).toContain("Usar outro endereço de cobrança");
    expect(source).toContain("Esta venda pode ser confirmada?");
    expect(source).toContain("Nova categoria a receber");
    expect(source).toContain("Nova conta");
  });

  it("does not auto-select a sale and keeps seller, product image and actions in the compact list", () => {
    expect(source).toContain("setSelectedId(initialSelectedId ?? null)");
    expect(source).not.toContain("setSelectedId(list.data.items[0].publicId)");
    const compactRow = source.slice(
      source.indexOf('data-testid={`sale-row-${order.publicId}`}'),
      source.indexOf("{list.data && (")
    );
    expect(compactRow).toContain("sellerName");
    expect(compactRow).toContain("firstProductImage");
    expect(compactRow).toContain("SaleActionsMenu");
  });

  it("offers one primary filter bar and server-side page sizes", () => {
    expect(source).toContain("Buscar por número ou cliente...");
    expect(source).toContain("Tipos de venda");
    expect(source).toContain("Filtros avançados");
    expect(source).toContain("Itens por página");
    expect(source).toContain("[6, 10, 20, 50, 100]");
    expect(source).toContain("salesPaginationItems(page, list.data.totalPages)");
  });

  it("routes private sale document links to the authenticated API host", () => {
    expect(source).toContain("saleDocumentUrl(document.downloadUrl)");
    expect(source).toContain("?preview=1");
  });

  it("records pending, partial or paid state through real received amounts", () => {
    expect(source).toContain('paymentStatus: "pending"');
    expect(source).toContain('paymentStatus === "partial"');
    expect(source).toContain("receivedCents: state.receivedCents");
    expect(source).toContain("Isenção não está disponível");
  });

  it("edits payment only through the Finance settlement contract", () => {
    expect(source).toContain("trpc.erp.finance.settle.useMutation()");
    expect(source).toContain("financialAccountPublicId: accountId");
    expect(source).toContain("amountCents, idempotencyKey");
    expect(source).toContain("await utils.erp.invalidate()");
    expect(source).toContain("Reverter um recebimento exige estorno financeiro");
    expect(source).not.toContain("setPaymentStatus(order.publicId");
  });

  it("separates quote and sale workflows with real contextual operations", () => {
    expect(source).toContain("DocumentTypeBadge");
    expect(source).toContain("CommercialBadge");
    expect(source).toContain("Converter em venda");
    expect(source).toContain("Iniciar negociação");
    expect(source).toContain("Aprovar orçamento");
    expect(source).toContain("Duplicar como rascunho");
    expect(source).toContain("trpc.erp.sales.convertQuote.useMutation");
    expect(source).toContain("trpc.erp.sales.commercialTransition.useMutation");
    expect(source).toContain("trpc.erp.sales.archive.useMutation");
  });

  it("renders solid portal menus, proportional sale-product media and complete commercial fields", () => {
    expect(source).toContain('className="z-[80] min-w-60 border-slate-200 bg-white shadow-xl"');
    expect(source).toContain('featured ? "h-14 w-14"');
    expect(source).toContain('compact ? "h-9 w-9"');
    expect(source).toContain("object-contain p-1");
    expect(source).toContain("Data comercial");
    expect(source).toContain("Condições de pagamento");
    expect(source).toContain("Outros encargos");
  });

  it("uses the shared calendar-date parser in export, desktop, mobile and detail", () => {
    expect(source.match(/date\.format\(salesCommercialDate\(order\.commercialDate\)\)/g)).toHaveLength(4);
    expect(source).not.toContain("new Date(order.commercialDate ?? order.createdAt)");
  });

  it("places financial conditions and the confirmation decision side by side", () => {
    expect(source).toContain('data-testid="sales-confirmation-layout"');
    expect(source).toContain('data-testid="sales-confirmation-financial"');
    expect(source).toContain('data-testid="sales-confirmation-decision"');
    expect(source).toContain("lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.85fr)]");
    expect(source).not.toContain("max-h-64 space-y-2 overflow-y-auto border-t");
    const decision = source.slice(
      source.indexOf('data-testid="sales-confirmation-decision"'),
      source.indexOf("</aside>", source.indexOf('data-testid="sales-confirmation-decision"'))
    );
    expect(decision).toContain("Esta venda pode ser confirmada?");
    expect(decision).toContain("Confirmar venda e criar títulos");
  });

  it("prioritizes real sale products in compact rows with quantities and values", () => {
    const products = source.slice(
      source.indexOf('data-testid="sales-detail-products"'),
      source.indexOf('data-testid="sales-detail-address"')
    );
    expect(products).toContain("item.canonicalImage?.thumbnailPath");
    expect(products).toContain("item.productName");
    expect(products).toContain("item.quantity");
    expect(products).toContain("item.unitPriceCents");
    expect(products).toContain("item.lineTotalCents");
    expect(products).toContain('data-testid="sales-detail-product-row"');
    expect(source).toContain("Nenhum produto registrado nesta venda.");
    expect(source).toContain("Imagem de ${name}");
  });

  it("keeps workflow actions together with solid correction and destructive treatments", () => {
    const actions = source.slice(
      source.indexOf('data-testid="sales-detail-actions"'),
      source.indexOf("</section>", source.indexOf('data-testid="sales-detail-actions"'))
    );
    expect(actions).toContain("nextActionLabel(next)");
    expect(source).toContain('if (stage === "separation") return "Iniciar separação"');
    expect(source).toContain('if (stage === "shipped") return "Marcar como enviado"');
    expect(actions).toContain("Corrigir etapa");
    expect(actions).toContain("bg-slate-100");
    expect(actions).toContain("Cancelar venda");
    expect(actions).toContain("bg-rose-50");
    expect(actions).toContain("order.paidCents > 0");
  });

  it("keeps a failed quote edit open and exposes the real mutation error", () => {
    expect(source).toContain("onError: error => setLocalError(salesMutationErrorMessage(error))");
    expect(source).toContain("function salesMutationErrorMessage(error: unknown)");
    expect(source).toContain("formError={localError}");
    expect(source).toContain('{formError && <p role="alert"');
    expect(source).toContain("create.reset()");
    expect(source).toContain("update.reset()");
    expect(source).toContain("{busy ? \"Salvando…\" : `Salvar ${form.documentType === \"quote\" ? \"orçamento\" : \"venda\"}`}");
  });

  it("allows an explicit quote-only shortage confirmation while keeping sales blocked", () => {
    expect(source).toContain('if (stockIssues.length && form.documentType === "sale")');
    expect(source).toContain("QuoteStockConfirmationDialog");
    expect(source).toContain("Produto sem estoque");
    expect(source).toContain("Este produto não possui estoque suficiente para atender à quantidade solicitada. Deseja continuar com o orçamento mesmo assim?");
    expect(source).toContain("salesStockIssues(form.items)");
    expect(source).toContain("Voltar e revisar");
    expect(source).toContain("Continuar orçamento");
    expect(source).toContain('form.documentType === "sale" && stockIssues.length > 0');
    expect(source).toContain('if (form.documentType === "sale" && Number(product.availableQuantity) <= 0) return;');
  });

  it("keeps commercial history factual, collapsible and free of CRM technical ids", () => {
    expect(source).toContain("function DocumentHistory");
    expect(source).toContain("aria-expanded={expanded}");
    expect(source).toContain("Histórico <span className=\"rounded-full bg-slate-100");
    expect(source).toContain('documentType === "quote" ? "Orçamento criado" : "Venda criada"');
    expect(source).toContain("Negociação iniciada");
    expect(source).toContain("Venda criada a partir do orçamento");
    expect(source).not.toContain("detail: order.crmClientId");
  });

  it("keeps quote conversion identity and reports a server-side stock failure in its dialog", () => {
    expect(source).toContain("A operação preservará a identidade do pedido");
    expect(source).toContain("validará o estoque no servidor");
    expect(source).toContain("error={conversionError}");
  });

  it("uses the requested delivery label, visual separators and individual action feedback", () => {
    expect(source).toContain("formatSalesDeliveryAddress(order.shippingAddress)");
    expect(source).toContain("sm:divide-x sm:divide-y-0");
    expect(source).toContain("Novo Pedido");
    expect(source).toContain("Nova venda/Pedido");
    expect(source).toContain("border-amber-200 bg-amber-50");
  });

  it("uses a quote-only, auditable delete action without offering physical sale deletion", () => {
    expect(source).toContain("Excluir orçamento");
    expect(source).toContain('order.documentType === "quote" && order.commercialStatus !== "converted"');
    expect(source).toContain("O orçamento será removido apenas das listas ativas");
    expect(source).toContain("nenhuma venda será excluída");
  });

  it("gives the sales-specific action controls a visible surface and interaction states", () => {
    expect(source).toContain("function Button({ className, variant = \"default\", ...props }");
    expect(source).toContain("bg-slate-50 text-slate-800 shadow-sm");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).toContain("data-[highlighted]:bg-slate-100");
    expect(source).toContain('data-testid="sales-row-actions"');
  });

  it("keeps a vertical desktop table, anchored filters and the existing premium pagination", () => {
    expect(source).toContain('data-testid={`sale-row-${order.publicId}`}');
    expect(source).toContain('className="min-w-[1120px] w-full text-sm"');
    expect(source).toContain('<th className="px-2 py-2">Cliente</th>');
    expect(source).toContain('<th className="px-2 py-2">Vendedor</th>');
    expect(source).toContain("firstProductImage?.thumbnailPath");
    expect(source).toContain('text-sm font-bold text-slate-900');
    expect(source).toContain('flex flex-wrap items-center gap-2 rounded-xl border');
    expect(source).toContain('data-testid="sales-customer-filter-options"');
    expect(source).not.toContain('min-[980px]:grid-cols');
    expect(source).not.toContain('min-w-[min(18rem,calc(100vw-2rem))]');
    expect(source).toContain('data-testid="sales-metric-card"');
    expect(source).toContain('lg:grid-cols-4');
    expect(source).toContain('data-testid="sales-premium-pagination"');
    expect(source).toContain("from-slate-950 via-slate-900 to-slate-800");
    expect(source).toContain("salesPaginationItems(page, list.data.totalPages)");
    expect(source).toContain("activeFilterCount");
    expect(source).toContain("motion-reduce:transition-none");
  });
});
