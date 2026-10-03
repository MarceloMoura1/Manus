import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import {
  PURCHASE_PUBLIC_ERROR_MESSAGE,
  purchaseFailureDiagnostic,
  runPurchaseOperation,
} from "./router";

describe("purchase router error boundary", () => {
  it("preserves public domain errors", async () => {
    await expect(
      runPurchaseOperation(async () => {
        throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Pedido não encontrado." });
  });

  it("sanitizes mysql driver errors without exposing SQL or bind values", async () => {
    const error = Object.assign(
      new Error("Bind parameters must not contain undefined: SELECT secret FROM table"),
      { code: "ER_WRONG_ARGUMENTS", errno: 1210, sqlState: "HY000" }
    );
    const diagnostic = purchaseFailureDiagnostic(error);
    expect(diagnostic).toEqual({
      name: "Error",
      code: "ER_WRONG_ARGUMENTS",
      errno: 1210,
      sqlState: "HY000",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("SELECT secret");

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        runPurchaseOperation(async () => {
          throw error;
        })
      ).rejects.toEqual(
        expect.objectContaining<Partial<TRPCError>>({
          code: "INTERNAL_SERVER_ERROR",
          message: PURCHASE_PUBLIC_ERROR_MESSAGE,
        })
      );
    } finally {
      log.mockRestore();
    }
  });
});
