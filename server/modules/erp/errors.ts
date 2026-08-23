export type ErpErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INSUFFICIENT_STOCK" | "INACTIVE_PRODUCT" | "IDEMPOTENCY_CONFLICT" | "ALREADY_REVERSED" | "VALIDATION";
export class ErpDomainError extends Error {
  constructor(readonly code: ErpErrorCode, message: string) { super(message); this.name = "ErpDomainError"; }
}
export function erpTrpcCode(error: ErpDomainError): "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST" { return error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "FORBIDDEN" ? "FORBIDDEN" : error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "ALREADY_REVERSED" ? "CONFLICT" : "BAD_REQUEST"; }
