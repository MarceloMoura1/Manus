import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCep,
  formatCpfCnpj,
  formatMoneyCents,
} from "./SuppliersPage";

const suppliersSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/erp/SuppliersPage.tsx"),
  "utf8"
);
const workspaceSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
  "utf8"
);
const purchasesContractsSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/modules/erp/purchases/contracts.ts"),
  "utf8"
);
const purchasesRepoSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/modules/erp/purchases/repository.ts"),
  "utf8"
);

describe("ERP Fornecedores V2 — Suíte de Testes Estruturais e de Domínio", () => {
  // 1. Lista de fornecedores
  it("1. renderiza a lista de fornecedores com contagem e paginação", () => {
    expect(suppliersSource).toContain('data-testid="erp-suppliers-page"');
    expect(suppliersSource).toContain("Fornecedores");
    expect(suppliersSource).toContain("suppliersQuery.data?.total");
    expect(suppliersSource).toContain("fornecedor{");
  });

  // 2. Busca
  it("2. possui busca unificada por fornecedor, documento e telefone", () => {
    expect(suppliersSource).toContain(
      'placeholder="Buscar fornecedor, documento, telefone..."'
    );
    expect(suppliersSource).toContain("search: search.trim()");
    expect(suppliersSource).toContain("setPage(1)");
  });

  // 3. Filtros
  it("3. oferece filtros rápidos de status (Ativos, Inativos, Todos)", () => {
    expect(suppliersSource).toContain('aria-label="Filtrar fornecedores por status"');
    expect(suppliersSource).toContain('["active", "Ativos"]');
    expect(suppliersSource).toContain('["inactive", "Inativos"]');
    expect(suppliersSource).toContain('["all", "Todos"]');
    expect(suppliersSource).toContain(
      "activeFilter === \"all\" ? undefined : activeFilter === \"active\""
    );
  });

  // 4. Seleção
  it("4. suporta seleção clara do fornecedor com destaque visual", () => {
    expect(suppliersSource).toContain("selectedSupplierId === supplier.publicId");
    expect(suppliersSource).toContain("border-blue-200 bg-blue-50/80 ring-1 ring-blue-200");
    expect(suppliersSource).toContain("setSelectedSupplierId(supplier.publicId)");
  });

  // 5. Estado vazio
  it("5. apresenta empty state descritivo quando nenhum fornecedor está selecionado", () => {
    expect(suppliersSource).toContain("Selecione um fornecedor");
    expect(suppliersSource).toContain(
      "Escolha um fornecedor da lista para consultar produtos, compras e informações do relacionamento."
    );
  });

  // 6. Header do fornecedor
  it("6. exibe cabeçalho completo do fornecedor com nome comercial, razão social e badges", () => {
    expect(suppliersSource).toContain("supplier.tradeName || supplier.legalName");
    expect(suppliersSource).toContain("supplier.legalName");
    expect(suppliersSource).toContain("Pessoa Jurídica");
    expect(suppliersSource).toContain("Pessoa Física");
    expect(suppliersSource).toContain("supplier.active ? \"Ativo\" : \"Inativo\"");
  });

  // 7. Abas
  it("7. disponibiliza as cinco abas canônicas do workspace operacional", () => {
    expect(suppliersSource).toContain('activeTab === "geral"');
    expect(suppliersSource).toContain('activeTab === "produtos"');
    expect(suppliersSource).toContain('activeTab === "compras"');
    expect(suppliersSource).toContain('activeTab === "timeline"');
    expect(suppliersSource).toContain('activeTab === "arquivos"');
  });

  // 8. Visão geral
  it("8. organiza a aba Visão Geral em seções de Contato, Identificação, Endereço e Observações", () => {
    expect(suppliersSource).toContain("TabOverview");
    expect(suppliersSource).toContain("Contato principal:");
    expect(suppliersSource).toContain("Identificação Cadastral");
    expect(suppliersSource).toContain("Relacionamento Comercial");
    expect(suppliersSource).toContain("Observações Internas");
  });

  // 9. WhatsApp
  it("9. integra ação de WhatsApp reutilizando padrão canônico seguro wa.me", () => {
    expect(suppliersSource).toContain("handleOpenWhatsApp");
    expect(suppliersSource).toContain("normalizeContactPhone(supplier.phone)");
    expect(suppliersSource).toContain("https://wa.me/");
    expect(suppliersSource).toContain("hasValidPhone");
  });

  // 10. Cadastro
  it("10. oferece modal de cadastro organizado em seções e com validações", () => {
    expect(suppliersSource).toContain("SupplierFormDialog");
    expect(suppliersSource).toContain("1. Identificação");
    expect(suppliersSource).toContain("2. Contato");
    expect(suppliersSource).toContain("3. Endereço");
    expect(suppliersSource).toContain("4. Observações Comerciais");
    expect(suppliersSource).toContain("trpc.erp.suppliers.create.useMutation");
  });

  // 11. Edição
  it("11. permite edição contextual do fornecedor selecionado", () => {
    expect(suppliersSource).toContain("Editar Fornecedor");
    expect(suppliersSource).toContain("trpc.erp.suppliers.update.useMutation");
    expect(suppliersSource).toContain("setEditSupplierData(selectedSupplier)");
  });

  // 12. Produtos relacionados quando suportados
  it("12. lista e vincula produtos através da tabela canônica erp_product_suppliers", () => {
    expect(suppliersSource).toContain("trpc.erp.productSuppliers.list.useQuery");
    expect(suppliersSource).toContain("supplierPublicId: supplier.publicId");
    expect(suppliersSource).toContain("productMediaUrl");
    expect(suppliersSource).toContain("LinkProductDialog");
    expect(suppliersSource).toContain("trpc.erp.productSuppliers.create.useMutation");
    expect(suppliersSource).toContain("trpc.erp.productSuppliers.setPreferred.useMutation");
    expect(suppliersSource).toContain("trpc.erp.productSuppliers.delete.useMutation");
  });

  // 13. Compras
  it("13. exibe histórico de compras e indicadores calculados factualmente", () => {
    expect(suppliersSource).toContain("TabPurchases");
    expect(suppliersSource).toContain("trpc.erp.purchases.list.useQuery");
    expect(suppliersSource).toContain("supplierPublicId: supplier.publicId");
    expect(suppliersSource).toContain("Total Comprado");
    expect(suppliersSource).toContain("Última Compra");
    expect(suppliersSource).toContain("Ticket Médio");
    expect(purchasesContractsSource).toContain("supplierPublicId: z.string().uuid().optional()");
    expect(purchasesRepoSource).toContain("s.public_id=?");
  });

  // 14. Timeline quando suportada
  it("14. renderiza timeline cronológica factual agregando criação, vínculos e compras", () => {
    expect(suppliersSource).toContain("TabTimeline");
    expect(suppliersSource).toContain("Fornecedor Cadastrado");
    expect(suppliersSource).toContain("Produto Vinculado");
    expect(suppliersSource).toContain("Criado");
    expect(suppliersSource).toContain("Recebido");
  });

  // 15. Arquivos quando suportados
  it("15. apresenta estado descritivo na aba Arquivos informando isolamento privado", () => {
    expect(suppliersSource).toContain("TabFiles");
    expect(suppliersSource).toContain("Documentos e Anexos Comerciais");
    expect(suppliersSource).toContain("isolado por tenant");
  });

  // 16. Display name de usuários
  it("16. nunca exibe UUID como label principal de usuário na timeline", () => {
    expect(suppliersSource).toContain('actor: "Usuário indisponível"');
    expect(suppliersSource).toContain("Responsável: {ev.actor}");
    // Confirma que não há concatenação de UUID no label primário
    expect(suppliersSource).not.toMatch(/Responsável:\s*\{[a-zA-Z0-9_.]*Id\}/);
  });

  // 17. Ausência estrita de Zona de Risco
  it("17. DANGER_ZONE_CREATED=NO: não renderiza seção vermelha Zona de Risco", () => {
    expect(suppliersSource).not.toContain("Zona de risco");
    expect(suppliersSource).not.toContain("risk-zone-title");
    expect(suppliersSource).not.toContain("bg-red-50/40");
  });

  // 18. Formatadores auxiliares (Moeda, CPF/CNPJ, CEP)
  it("18. formata CPF, CNPJ, CEP e Moeda com rigor", () => {
    expect(formatCpfCnpj("12345678901")).toBe("123.456.789-01");
    expect(formatCpfCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatCpfCnpj(null)).toBe("—");
    expect(formatCep("01310100")).toBe("01310-100");
    expect(formatCep(null)).toBe("—");
    expect(formatMoneyCents(4590)).toMatch(/45,90/);
    expect(formatMoneyCents(null)).toBe("—");
  });

  // 19. Responsividade estrutural
  it("19. adota estrutura responsiva master/detail com toggle mobile e desktop side-by-side", () => {
    expect(suppliersSource).toContain("flex h-full min-w-0 flex-col gap-0 overflow-hidden rounded-[28px]");
    expect(suppliersSource).toContain("hidden lg:flex lg:w-80 xl:w-96");
    expect(suppliersSource).toContain("lg:hidden");
  });

  // 20. Integração com ERPWorkspace
  it("20. ERPWorkspace passa propriedades contextuais de navegação e WhatsApp para SuppliersPage", () => {
    expect(workspaceSource).toContain("<SuppliersPage onNavigate={onNavigate} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation} onClientNavigate={onClientNavigate}/>");
  });

  // 21. Isolamento de Stock V3 e Ausência de Migration 0031 / 0032
  it("21. STOCK_V3_ISOLATION: SuppliersPage não possui dependência da migration 0031 ou tabela não commitada", () => {
    expect(suppliersSource).not.toContain("0031");
    expect(suppliersSource).not.toContain("0032");
    expect(suppliersSource).not.toContain("erp_inventory");
  });
});
