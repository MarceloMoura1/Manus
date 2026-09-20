import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const suppliersSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/erp/SuppliersPage.tsx"),
  "utf8"
);

describe("ERP Fornecedores V2 — TabFiles & Timeline UI Architecture", () => {
  // 1. Aba Arquivos & Estrutura
  it("1. TAB_FILES_STRUCTURE: contém a aba de Arquivos com ícone e cabeçalho documental", () => {
    expect(suppliersSource).toContain('{ id: "arquivos", label: "Arquivos", icon: <Paperclip className="h-3.5 w-3.5" /> }');
    expect(suppliersSource).toContain("Documentos e Anexos Comerciais");
    expect(suppliersSource).toContain("Armazenamento estritamente privado, autenticado e isolado por tenant");
  });

  // 2. Filtros por Categoria
  it("2. CATEGORY_FILTERS: possui filtros pills por categoria com contadores", () => {
    expect(suppliersSource).toContain('FILE_CATEGORIES');
    expect(suppliersSource).toContain('"contracts"');
    expect(suppliersSource).toContain('"invoices"');
    expect(suppliersSource).toContain('"price_tables"');
    expect(suppliersSource).toContain('"fiscal_documents"');
    expect(suppliersSource).toContain('"other"');
    expect(suppliersSource).toContain("categoryCounts");
    expect(suppliersSource).toContain("setSelectedCategory");
  });

  // 3. Botão Anexar Documento & Permission Guard
  it("3. UPLOAD_PERMISSION_GUARD: botão de anexar documento é protegido por canWrite", () => {
    expect(suppliersSource).toContain("canWrite && (");
    expect(suppliersSource).toContain("setIsUploadModalOpen(true)");
    expect(suppliersSource).toContain("Anexar Documento");
  });

  // 4. Modal de Upload e Dropzone
  it("4. UPLOAD_MODAL: modal de upload possui dropzone, input de categoria e descrição", () => {
    expect(suppliersSource).toContain("SupplierFileUploadDialog");
    expect(suppliersSource).toContain("file-upload-input");
    expect(suppliersSource).toContain("accept=\".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.docx,.xlsx\"");
    expect(suppliersSource).toContain("20 * 1024 * 1024");
    expect(suppliersSource).toContain("O arquivo excede o limite máximo permitido de 20 MB.");
    expect(suppliersSource).toContain("Categoria do Documento");
    expect(suppliersSource).toContain("Descrição ou Observações (opcional)");
    expect(suppliersSource).toContain("FileReader");
    expect(suppliersSource).toContain("readAsDataURL");
  });

  // 5. Lista de Documentos e Renderização
  it("5. DOCUMENT_LIST: renderiza lista de documentos com metadados e badge de categoria", () => {
    expect(suppliersSource).toContain("getFileCategoryBadgeClass");
    expect(suppliersSource).toContain("formatFileSize");
    expect(suppliersSource).toContain("formatDateTime(file.createdAt)");
    expect(suppliersSource).toContain("Enviado por: {formatActorName(file.createdByName)}");
  });

  // 6. Download Seguro
  it("6. SECURE_DOWNLOAD: ação de download aponta para endpoint autenticado", () => {
    expect(suppliersSource).toContain("href={file.downloadUrl}");
    expect(suppliersSource).toContain("download={file.fileName}");
    expect(suppliersSource).toContain("Baixar");
  });

  // 7. Exclusão e Modal de Confirmação
  it("7. DELETE_CONFIRMATION: exclusão exige confirmação e respeita canWrite", () => {
    expect(suppliersSource).toContain("setFileToDelete(file)");
    expect(suppliersSource).toContain("Excluir Documento");
    expect(suppliersSource).toContain("Tem certeza que deseja remover o documento");
    expect(suppliersSource).toContain("Confirmar Exclusão");
    expect(suppliersSource).toContain("deleteMutation.mutate");
  });

  // 8. Empty States
  it("8. EMPTY_STATES: possui empty state geral e de categoria filtrada", () => {
    expect(suppliersSource).toContain("Nenhum documento anexado");
    expect(suppliersSource).toContain("Nenhum documento nesta categoria");
    expect(suppliersSource).toContain("Ver todos os documentos");
  });

  // 9. Integração com Timeline
  it("9. TIMELINE_INTEGRATION: timeline registra eventos de documento adicionado e removido", () => {
    expect(suppliersSource).toContain("Documento Adicionado");
    expect(suppliersSource).toContain("Documento Removido");
    expect(suppliersSource).toContain('"${file.fileName}" anexado');
    expect(suppliersSource).toContain('"${file.fileName}" removido');
    expect(suppliersSource).toContain("formatActorName(file.createdByName)");
    expect(suppliersSource).toContain("formatActorName(file.deletedByName || file.createdByName)");
  });

  // 10. Design System & Light/Dark Theme
  it("10. LIGHT_DARK_THEME: possui classes explícitas para modo claro e escuro", () => {
    expect(suppliersSource).toContain("dark:border-slate-800");
    expect(suppliersSource).toContain("dark:bg-slate-900");
    expect(suppliersSource).toContain("dark:text-slate-100");
    expect(suppliersSource).toContain("dark:text-slate-400");
  });
});
