import { describe, it, expect } from "vitest";
import { contactsForForm, type AdditionalContact } from "./ClientesPage";

describe("MegaDesk CRM — Etapa 2B.3: Preservação de Contatos B2B em ClientesPage", () => {
  it("preserva campos estendidos B2B (name, role, email, etc.) ao desserializar contacts_json", () => {
    const rawJson = JSON.stringify([
      {
        name: "Juliana Santos",
        role: "Diretora de Suprimentos",
        email: "juliana@fornecedor.com.br",
        phone: "11988887777",
        whatsapp: "11988887777",
        description: "Decisora de compras B2B",
        departamento: "Operações",
        idExterno: "ext-100",
      },
      {
        name: "Carlos Eduardo",
        role: "Gerente Financeiro",
        email: "carlos@fornecedor.com.br",
        phone: "11977776666",
        whatsapp: "11977776666",
        description: "Aprovações fiscais",
      },
    ]);

    const result = contactsForForm(rawJson);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "Juliana Santos",
      role: "Diretora de Suprimentos",
      email: "juliana@fornecedor.com.br",
      phone: "11988887777",
      whatsapp: "11988887777",
      description: "Decisora de compras B2B",
      departamento: "Operações",
      idExterno: "ext-100",
    });

    expect(result[1].name).toBe("Carlos Eduardo");
    expect(result[1].role).toBe("Gerente Financeiro");
    expect(result[1].email).toBe("carlos@fornecedor.com.br");
  });

  it("preserva campos B2B após ciclo completo de edição e submissão do formulário", () => {
    // 1. Contatos B2B criados na tela de Leads
    const initialContactsB2B = [
      {
        name: "Mariana Lima",
        role: "Compradora Sênior",
        email: "mariana@acme.com",
        phone: "11999990000",
        whatsapp: "11999990000",
        description: "Contato principal de cotações",
      },
    ];

    // 2. Carregados para o formulário de edição de Clientes
    const formContacts: AdditionalContact[] = contactsForForm(JSON.stringify(initialContactsB2B));

    // 3. Usuário edita apenas o telefone pelo formulário da tela de Clientes
    formContacts[0].phone = "11999991111";

    // 4. Simulando a transformação do handleSubmit de ClientesPage
    const submittedContacts = formContacts.map(contact => ({
      ...contact,
      phone: contact.phone.trim(),
      whatsapp: contact.whatsapp.trim(),
      description: contact.description?.trim() || "",
    }));

    // 5. Garantir que name, role e email NÃO foram descartados
    expect(submittedContacts[0]).toEqual({
      name: "Mariana Lima",
      role: "Compradora Sênior",
      email: "mariana@acme.com",
      phone: "11999991111", // Atualizado
      whatsapp: "11999990000", // Preservado
      description: "Contato principal de cotações", // Preservado
    });
  });

  it("trata graciosamente entradas vazias, nulas ou malformadas", () => {
    expect(contactsForForm(null)).toEqual([]);
    expect(contactsForForm("")).toEqual([]);
    expect(contactsForForm("   ")).toEqual([]);
    expect(contactsForForm("json-invalido")).toEqual([]);
    expect(contactsForForm(JSON.stringify("string-nao-array"))).toEqual([]);
    expect(contactsForForm(JSON.stringify([null, undefined, {}]))).toEqual([
      { name: "", role: "", email: "", phone: "", whatsapp: "", description: "" },
      { name: "", role: "", email: "", phone: "", whatsapp: "", description: "" },
      { name: "", role: "", email: "", phone: "", whatsapp: "", description: "" },
    ]);
  });
});
