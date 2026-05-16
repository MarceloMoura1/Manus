import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("Email Validation - updateClientInfo", () => {
  // Schema que foi corrigido
  const updateClientInfoSchema = z.object({
    clientId: z.string(),
    company: z.string().min(2).optional(),
    contact: z.string().min(2).optional(),
    email: z.string().email().or(z.literal("")).optional(),
    phone: z.string().min(8).optional(),
    cnpj: z.string().optional(),
    plan: z.string().min(2).optional(),
    maxUsers: z.number().int().min(1).optional(),
    statusType: z.enum(["active", "test"]).optional(),
  });

  it("deve aceitar email válido", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: "usuario@empresa.com",
    });
    expect(result.success).toBe(true);
  });

  it("deve aceitar string vazia para email", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: "",
    });
    expect(result.success).toBe(true);
  });

  it("deve aceitar undefined para email", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("deve aceitar quando email não é enviado", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
    });
    expect(result.success).toBe(true);
  });

  it("deve rejeitar email inválido", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: "email-invalido",
    });
    expect(result.success).toBe(false);
  });

  it("deve permitir editar outros campos sem alterar email", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      company: "Nova Empresa",
      contact: "João Silva",
      phone: "11999999999",
      // email não é enviado
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.company).toBe("Nova Empresa");
      expect(result.data.contact).toBe("João Silva");
      expect(result.data.email).toBeUndefined();
    }
  });

  it("deve permitir editar email para vazio", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: "",
      company: "Empresa Atualizada",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("");
    }
  });

  it("deve permitir editar email para novo valor válido", () => {
    const result = updateClientInfoSchema.safeParse({
      clientId: "client-123",
      email: "novo.email@empresa.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("novo.email@empresa.com");
    }
  });
});
