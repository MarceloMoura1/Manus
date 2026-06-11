/**
 * Tipos compartilhados do servidor MegaDesk.
 * Centraliza definições que eram importadas incorretamente de schema.ts.
 */

export type UserRole = "admin" | "user";

/**
 * Usuário autenticado no contexto tRPC.
 * Pode vir do OAuth (Manus) ou do JWT próprio (MegaAdmin).
 */
export interface User {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}
