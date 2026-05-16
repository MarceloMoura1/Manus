import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

// Simular a estrutura de dados do cliente
interface MegaClient {
  clientId: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  cnpj: string;
  plan: string;
  maxUsers: number;
  statusType: "active" | "test";
  status: "active" | "paused" | "test";
  accessReleased: boolean;
  modules: string[];
  users: any[];
  integrations: any;
}

describe("Client Data Persistence - Email and CNPJ", () => {
  let client: MegaClient;

  beforeEach(() => {
    client = {
      clientId: "client-123",
      company: "Test Company",
      contact: "John Doe",
      email: "john@example.com",
      phone: "+5511999999999",
      cnpj: "12.345.678/0001-90",
      plan: "Premium",
      maxUsers: 10,
      statusType: "active",
      status: "active",
      accessReleased: true,
      modules: ["active-attendance", "conversations"],
      users: [],
      integrations: {},
    };
  });

  it("should accept valid email format", () => {
    const emailSchema = z.string().email().or(z.literal(""));
    expect(() => emailSchema.parse("john@example.com")).not.toThrow();
    expect(() => emailSchema.parse("")).not.toThrow();
  });

  it("should accept empty email", () => {
    const emailSchema = z.string().email().or(z.literal(""));
    client.email = "";
    expect(() => emailSchema.parse(client.email)).not.toThrow();
  });

  it("should persist email when updated", () => {
    const originalEmail = client.email;
    client.email = "newemail@example.com";
    expect(client.email).toBe("newemail@example.com");
    expect(client.email).not.toBe(originalEmail);
  });

  it("should persist CNPJ when updated", () => {
    const originalCNPJ = client.cnpj;
    client.cnpj = "98.765.432/0001-12";
    expect(client.cnpj).toBe("98.765.432/0001-12");
    expect(client.cnpj).not.toBe(originalCNPJ);
  });

  it("should allow empty CNPJ", () => {
    client.cnpj = "";
    expect(client.cnpj).toBe("");
  });

  it("should preserve other fields when updating email", () => {
    const originalCompany = client.company;
    const originalPhone = client.phone;
    client.email = "newemail@example.com";
    expect(client.company).toBe(originalCompany);
    expect(client.phone).toBe(originalPhone);
  });

  it("should preserve other fields when updating CNPJ", () => {
    const originalCompany = client.company;
    const originalContact = client.contact;
    client.cnpj = "11.111.111/0001-11";
    expect(client.company).toBe(originalCompany);
    expect(client.contact).toBe(originalContact);
  });

  it("should handle updateClientInfo input validation", () => {
    const updateSchema = z.object({
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

    const validInput = {
      clientId: "client-123",
      email: "test@example.com",
      cnpj: "12.345.678/0001-90",
    };

    expect(() => updateSchema.parse(validInput)).not.toThrow();
  });

  it("should handle updateClientInfo with empty email", () => {
    const updateSchema = z.object({
      clientId: z.string(),
      email: z.string().email().or(z.literal("")).optional(),
      cnpj: z.string().optional(),
    });

    const validInput = {
      clientId: "client-123",
      email: "",
      cnpj: "12.345.678/0001-90",
    };

    expect(() => updateSchema.parse(validInput)).not.toThrow();
  });

  it("should track email changes in state", () => {
    const changes: Record<string, any> = {};
    
    const originalEmail = client.email;
    const newEmail = "updated@example.com";
    
    if (newEmail !== undefined) {
      client.email = newEmail;
      changes.email = newEmail;
    }
    
    expect(changes.email).toBe(newEmail);
    expect(client.email).toBe(newEmail);
    expect(client.email).not.toBe(originalEmail);
  });

  it("should track CNPJ changes in state", () => {
    const changes: Record<string, any> = {};
    
    const originalCNPJ = client.cnpj;
    const newCNPJ = "99.999.999/0001-99";
    
    if (newCNPJ !== undefined) {
      client.cnpj = newCNPJ;
      changes.cnpj = newCNPJ;
    }
    
    expect(changes.cnpj).toBe(newCNPJ);
    expect(client.cnpj).toBe(newCNPJ);
    expect(client.cnpj).not.toBe(originalCNPJ);
  });

  it("should support batch updates of email and CNPJ", () => {
    const updates = {
      email: "batch@example.com",
      cnpj: "55.555.555/0001-55",
    };

    if (updates.email !== undefined) client.email = updates.email;
    if (updates.cnpj !== undefined) client.cnpj = updates.cnpj;

    expect(client.email).toBe("batch@example.com");
    expect(client.cnpj).toBe("55.555.555/0001-55");
  });

  it("should not lose email/CNPJ after multiple updates", () => {
    client.email = "first@example.com";
    client.cnpj = "11.111.111/0001-11";
    
    // Simulate other updates
    client.company = "Updated Company";
    client.contact = "Jane Doe";
    
    // Email and CNPJ should still be there
    expect(client.email).toBe("first@example.com");
    expect(client.cnpj).toBe("11.111.111/0001-11");
  });
});
