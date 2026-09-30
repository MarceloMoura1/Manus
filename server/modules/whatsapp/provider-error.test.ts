import { describe, expect, it, vi } from "vitest";
import { logWhatsAppProviderFailure, whatsappProviderDiagnostic, whatsappProviderPersistedError, whatsappProviderPublicMessage } from "./provider-error";

describe("WhatsApp provider error containment", () => {
  it("keeps nested provider secrets out of public, persisted and ordinary log surfaces", () => {
    const secret = "Bearer private-token password=hunter2 https://internal.example.test/key";
    const error = Object.assign(new Error(`request failed ${secret}`), { status: 401,
      response: { data: { token: secret } }, cause: new Error(secret), stack: `stack ${secret}` });
    const diagnostic = whatsappProviderDiagnostic(error, "send_media", "provider_request");
    const publicMessage = whatsappProviderPublicMessage(diagnostic);
    const persisted = whatsappProviderPersistedError(diagnostic);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logWhatsAppProviderFailure("[WA Provider] sanitized failure", diagnostic);
    const exposed = JSON.stringify([publicMessage, persisted, warn.mock.calls]);
    expect(diagnostic).toMatchObject({ failureClass: "PROVIDER_AUTH_FAILED", status: 401,
      operation: "send_media", stage: "provider_request" });
    expect(exposed).not.toContain("private-token");
    expect(exposed).not.toContain("hunter2");
    expect(exposed).not.toContain("internal.example.test");
    warn.mockRestore();
  });
});
