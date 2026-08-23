export type ErpErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INSUFFICIENT_STOCK" | "INACTIVE_PRODUCT" | "IDEMPOTENCY_CONFLICT" | "ALREADY_REVERSED" | "VALIDATION";
export class ErpDomainError extends Error {
  constructor(readonly code: ErpErrorCode, message: string) { super(message); this.name = "ErpDomainError"; }
}
