import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCep,
  formatCpfCnpj,
  formatMoneyCents,
  formatActorName,
  validateSupplierForm,
  type SupplierFormData,
} from "./SuppliersPage";

const suppliersSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/erp/SuppliersPage.tsx"),
  "utf8"
);
const workspaceSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
  "utf8"
);
const homeSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/Home.tsx"),
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

  // 4. Seleção e Fechamento com modelo explícito (Item 2)
  it("4. suporta seleção clara do fornecedor e fechamento explícito sem re-seleção automática", () => {
    expect(suppliersSource).toContain("selectedSupplierId === supplier.publicId");
    expect(suppliersSource).toContain("border-blue-200 bg-blue-50/80 ring-1 ring-blue-200");
    expect(suppliersSource).toContain("setSelectedSupplierId(supplier.publicId)");
    // Distingue seleção inicial de fechamento explícito pelo usuário
    expect(suppliersSource).toContain("userExplicitlyClosed");
    expect(suppliersSource).toContain("initialSelectionDone");
    // Ao clicar no botão fechar (X)
    expect(suppliersSource).toContain("setSelectedSupplierId(null)");
    expect(suppliersSource).toContain("setUserExplicitlyClosed(true)");
    // Ao clicar em outro fornecedor
    expect(suppliersSource).toContain("setUserExplicitlyClosed(false)");
  });

  // 5. Estado vazio neutro
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

  // 9. WhatsApp alinhado ao fluxo canônico de Clientes (Item 4)
  it("9. integra ação de WhatsApp reutilizando o fluxo canônico de Atendimento Ativo de Clientes", () => {
    expect(suppliersSource).toContain("handleOpenWhatsApp");
    expect(suppliersSource).toContain("normalizeContactPhone(supplier.phone)");
    expect(suppliersSource).toContain("hasValidPhone");
    expect(suppliersSource).toContain("whatsappConnected");
    expect(suppliersSource).toContain("canStartConversation");
    expect(suppliersSource).toContain("megadesk-navigate");
    expect(suppliersSource).toContain("active-attendance");
    expect(suppliersSource).toContain("onClientNavigate");
    // Home.tsx possui fallback seguro quando a entidade não está em crm_clients
    expect(homeSource).toContain("setNewAttendancePhone(phoneToPreFill)");
    expect(homeSource).toContain("setNewAttendanceOpen(true)");
  });

  // 10. Cadastro e Edição com mensagens acionáveis (Item 3)
  it("10. oferece modal de cadastro organizado em seções com validação acionável e preservação de campos", () => {
    expect(suppliersSource).toContain("SupplierFormDialog");
    expect(suppliersSource).toContain("1. Identificação");
    expect(suppliersSource).toContain("2. Contato");
    expect(suppliersSource).toContain("3. Endereço");
    expect(suppliersSource).toContain("4. Observações Comerciais");
    expect(suppliersSource).toContain("validateSupplierForm");
    expect(suppliersSource).toContain("fieldErrors");
    expect(suppliersSource).toContain("summaryError");
    expect(suppliersSource).toContain("trpc.erp.suppliers.create.useMutation");
    expect(suppliersSource).toContain("trpc.erp.suppliers.update.useMutation");
  });

  // 11. Edição
  it("11. permite edição contextual do fornecedor selecionado", () => {
    expect(suppliersSource).toContain("Editar Fornecedor");
    expect(suppliersSource).toContain("setEditSupplierData(selectedSupplier)");
  });

  // 12. Produtos relacionados e cardinalidade many-to-many (Item 1)
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

  // 14. Timeline com resolução de responsável (Item 5)
  it("14. renderiza timeline factual resolvendo display name do ator responsável", () => {
    expect(suppliersSource).toContain("TabTimeline");
    expect(suppliersSource).toContain("formatActorName(supplier.createdByName)");
    expect(suppliersSource).toContain("formatActorName(supplier.updatedByName || supplier.createdByName)");
    expect(suppliersSource).toContain("Responsável: {ev.actor}");
    // Nunca expõe UUID cru no label primário
    expect(suppliersSource).not.toMatch(/Responsável:\s*\{[a-zA-Z0-9_.]*Id\}/);
  });

  // 15. Arquivos tab
  it("15. apresenta estado descritivo na aba Arquivos informando isolamento privado", () => {
    expect(suppliersSource).toContain("TabFiles");
    expect(suppliersSource).toContain("Documentos e Anexos Comerciais");
    expect(suppliersSource).toContain("isolado por tenant");
  });

  // 16. Teste de unidade: formatActorName (Item 5)
  it("16. formatActorName resolve display name canônico e fallback seguro 'Usuário indisponível'", () => {
    expect(formatActorName("Carlos Silva")).toBe("Carlos Silva");
    expect(formatActorName("admin@megadesk.online")).toBe("admin@megadesk.online");
    expect(formatActorName(null)).toBe("Usuário indisponível");
    expect(formatActorName(undefined)).toBe("Usuário indisponível");
    expect(formatActorName("")).toBe("Usuário indisponível");
    expect(formatActorName("   ")).toBe("Usuário indisponível");
    // Nunca expõe UUID cru
    expect(formatActorName("213ac4c8-37ea-44b5-5042-8c1e6ffef537")).toBe("Usuário indisponível");
    expect(formatActorName("00000000-0000-0000-0000-000000000000")).toBe("Usuário indisponível");
  });

  // 17. Teste de unidade: validateSupplierForm - Mínimo PJ (Item 3)
  it("17. validateSupplierForm valida corretamente fornecedor PJ mínimo", () => {
    const validPJ: SupplierFormData = {
      personType: "legal",
      taxId: "11.222.333/0001-81", // valid CNPJ
      legalName: "Fornecedor Alpha LTDA",
      tradeName: "Alpha Distribuidora",
      phone: "(11) 98765-4321",
      email: "",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    const errors = validateSupplierForm(validPJ);
    expect(Object.keys(errors).length).toBe(0);
  });

  // 18. Teste de unidade: validateSupplierForm - Mínimo PF sem Nome Fantasia (Item 3)
  it("18. validateSupplierForm aceita fornecedor PF mínimo sem Nome Fantasia", () => {
    const validPF: SupplierFormData = {
      personType: "individual",
      taxId: "52998224725", // valid CPF
      legalName: "José da Silva",
      tradeName: "", // PF não exige tradeName
      phone: "",
      email: "jose@silva.com.br",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    const errors = validateSupplierForm(validPF);
    expect(Object.keys(errors).length).toBe(0);
  });

  // 19. Teste de unidade: validateSupplierForm - Erros de documento e contato (Item 3)
  it("19. validateSupplierForm rejeita documento inválido e ausência de canal de contato", () => {
    const invalidDocAndContact: SupplierFormData = {
      personType: "legal",
      taxId: "00000000000000",
      legalName: "Empresa Teste",
      tradeName: "Teste",
      phone: "",
      email: "",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    const errors = validateSupplierForm(invalidDocAndContact);
    expect(errors.taxId).toBe("CNPJ inválido.");
    expect(errors.contact).toBe("Informe pelo menos um telefone ou e-mail.");
  });

  // 20. Teste de unidade: validateSupplierForm - Formato de e-mail e CEP (Item 3)
  it("20. validateSupplierForm valida formatos opcionais de e-mail e CEP quando fornecidos", () => {
    const invalidFormats: SupplierFormData = {
      personType: "individual",
      taxId: "52998224725",
      legalName: "José da Silva",
      tradeName: "",
      phone: "",
      email: "email-invalido",
      stateRegistration: "",
      contactName: "",
      postalCode: "123", // CEP curto
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "SP",
      notes: "",
    };
    const errors = validateSupplierForm(invalidFormats);
    expect(errors.email).toBe("E-mail inválido.");
    expect(errors.postalCode).toBe("CEP deve conter 8 dígitos.");
  });

  // 21. Ausência estrita de Zona de Risco
  it("21. DANGER_ZONE_CREATED=NO: não renderiza seção vermelha Zona de Risco", () => {
    expect(suppliersSource).not.toContain("Zona de risco");
    expect(suppliersSource).not.toContain("risk-zone-title");
    expect(suppliersSource).not.toContain("bg-red-50/40");
  });

  // 22. Formatadores auxiliares (Moeda, CPF/CNPJ, CEP)
  it("22. formata CPF, CNPJ, CEP e Moeda com rigor", () => {
    expect(formatCpfCnpj("12345678901")).toBe("123.456.789-01");
    expect(formatCpfCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatCpfCnpj(null)).toBe("—");
    expect(formatCep("01310100")).toBe("01310-100");
    expect(formatCep(null)).toBe("—");
    expect(formatMoneyCents(4590)).toMatch(/45,90/);
    expect(formatMoneyCents(null)).toBe("—");
  });

  // 23. Responsividade estrutural
  it("23. adota estrutura responsiva master/detail com toggle mobile e desktop side-by-side", () => {
    expect(suppliersSource).toContain("flex h-full min-w-0 flex-col gap-0 overflow-hidden rounded-[28px]");
    expect(suppliersSource).toContain("hidden lg:flex lg:w-80 xl:w-96");
    expect(suppliersSource).toContain("lg:hidden");
  });

  // 24. Integração com ERPWorkspace
  it("24. ERPWorkspace passa propriedades contextuais de navegação e WhatsApp para SuppliersPage", () => {
    expect(workspaceSource).toContain("<SuppliersPage onNavigate={onNavigate} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation} onClientNavigate={onClientNavigate}/>");
  });

  // 25. Isolamento de Stock V3 e Ausência de Migration 0031 / 0032
  it("25. STOCK_V3_ISOLATION: SuppliersPage não possui dependência da migration 0031 ou tabela não commitada", () => {
    expect(suppliersSource).not.toContain("0031");
    expect(suppliersSource).not.toContain("0032");
    expect(suppliersSource).not.toContain("erp_inventory");
  });

  // 26. Adversarial: Strings em branco e whitespace-only
  it("26. validateSupplierForm rejeita strings com whitespace para campos obrigatórios", () => {
    const whitespacePJ: SupplierFormData = {
      personType: "legal",
      taxId: "   ",
      legalName: "     ",
      tradeName: "     ",
      phone: "   ",
      email: "   ",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    const errors = validateSupplierForm(whitespacePJ);
    expect(errors.legalName).toBe("Informe a razão social.");
    expect(errors.tradeName).toBe("Informe o nome fantasia.");
    expect(errors.taxId).toBe("Informe o CNPJ.");
    expect(errors.contact).toBe("Informe pelo menos um telefone ou e-mail.");
  });

  // 27. Adversarial: Documentos mascarados vs não mascarados
  it("27. validateSupplierForm aceita tanto CPF/CNPJ com máscara quanto sem máscara", () => {
    const maskedPJ: SupplierFormData = {
      personType: "legal",
      taxId: "11.222.333/0001-81",
      legalName: "Fornecedor Mascarado LTDA",
      tradeName: "Mascarado",
      phone: "11987654321",
      email: "",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    expect(Object.keys(validateSupplierForm(maskedPJ)).length).toBe(0);

    const unmaskedPJ: SupplierFormData = {
      ...maskedPJ,
      taxId: "11222333000181",
    };
    expect(Object.keys(validateSupplierForm(unmaskedPJ)).length).toBe(0);

    const unmaskedPF: SupplierFormData = {
      personType: "individual",
      taxId: "52998224725",
      legalName: "Pessoa Física Sem Máscara",
      tradeName: "",
      phone: "11987654321",
      email: "",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    expect(Object.keys(validateSupplierForm(unmaskedPF)).length).toBe(0);
  });

  // 28. Adversarial: Endereço parcialmente preenchido
  it("28. validateSupplierForm aceita endereço parcialmente preenchido sem obrigar campos adicionais", () => {
    const partialAddress: SupplierFormData = {
      personType: "individual",
      taxId: "52998224725",
      legalName: "Cliente Com Rua",
      tradeName: "",
      phone: "",
      email: "contato@teste.com",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "Rua das Flores", // Somente rua preenchida
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    const errors = validateSupplierForm(partialAddress);
    expect(Object.keys(errors).length).toBe(0);
  });

  // 29. Adversarial: Apenas telefone OU apenas e-mail satisfaz contato
  it("29. validateSupplierForm aceita contato apenas por telefone ou apenas por e-mail", () => {
    const phoneOnly: SupplierFormData = {
      personType: "individual",
      taxId: "52998224725",
      legalName: "Apenas Telefone",
      tradeName: "",
      phone: "11988887777",
      email: "",
      stateRegistration: "",
      contactName: "",
      postalCode: "",
      street: "",
      addressNumber: "",
      addressComplement: "",
      district: "",
      city: "",
      state: "",
      notes: "",
    };
    expect(Object.keys(validateSupplierForm(phoneOnly)).length).toBe(0);

    const emailOnly: SupplierFormData = {
      ...phoneOnly,
      legalName: "Apenas Email",
      phone: "",
      email: "fornecedor@email.com",
    };
    expect(Object.keys(validateSupplierForm(emailOnly)).length).toBe(0);
  });

  // 30. Adversarial: Home.tsx fallback para entidades que não estão no CRM (Fornecedores)
  it("30. Home.tsx handoff de WhatsApp lida com entidades não-CRM abrindo Novo Atendimento com telefone preenchido", () => {
    // Prova que Home.tsx detecta crmCustomerQuery.isError quando a entidade não está em crm_clients
    // e transfere o telefone com segurança para setNewAttendancePhone + setNewAttendanceOpen
    expect(homeSource).toMatch(/crmCustomerQuery\.isError/);
    expect(homeSource).toContain("const phoneToPreFill = crmIntent.phone;");
    expect(homeSource).toContain("setCrmIntent(null);");
    expect(homeSource).toContain("setCrmHandoffState('idle');");
    expect(homeSource).toContain("setNewAttendancePhone(phoneToPreFill);");
    expect(homeSource).toContain("setNewAttendanceOpen(true);");
  });
});
