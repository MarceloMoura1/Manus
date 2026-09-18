import { describe, expect, it } from "vitest";
import {
  isUserPersonalizationBackgroundPath,
  productMediaUrl,
  resolveUserPersonalizationBackgroundUrl,
  ticketAttachmentUrl,
  trpcBaseUrl,
  trpcProcedureUrl,
  userPersonalizationBackgroundUrl,
} from "./trpc-url";

describe("tRPC transport URL", () => {
  it.each(["app.megadesk.online", "admin.megadesk.online", "api.megadesk.online"])(
    "usa o host da API em produção para preservar a sessão (%s)",
    hostname => {
      expect(trpcBaseUrl(hostname)).toBe("https://api.megadesk.online/api/trpc");
      expect(trpcProcedureUrl("megadesk.sendMessage", hostname))
        .toBe("https://api.megadesk.online/api/trpc/megadesk.sendMessage");
      expect(userPersonalizationBackgroundUrl(hostname))
        .toBe("https://api.megadesk.online/api/user-personalization/background");
      expect(ticketAttachmentUrl("ticket a", "attachment/b", hostname))
        .toBe("https://api.megadesk.online/api/chamados/ticket%20a/attachments/attachment%2Fb/file");
      expect(productMediaUrl("/api/products/prod-123/images", hostname))
        .toBe("https://api.megadesk.online/api/products/prod-123/images");
      expect(productMediaUrl("api/products/prod-123/image?variant=thumbnail", hostname))
        .toBe("https://api.megadesk.online/api/products/prod-123/image?variant=thumbnail");
    },
  );

  it.each(["localhost", "127.0.0.1"])("mantém chamadas locais same-origin (%s)", hostname => {
    expect(trpcBaseUrl(hostname)).toBe("/api/trpc");
    expect(trpcProcedureUrl("megadesk.sendAttachment", hostname))
      .toBe("/api/trpc/megadesk.sendAttachment");
    expect(ticketAttachmentUrl("ticket-a", "attachment-a", hostname))
      .toBe("/api/chamados/ticket-a/attachments/attachment-a/file");
    expect(productMediaUrl("/api/products/prod-123/images", hostname))
      .toBe("/api/products/prod-123/images");
    expect(productMediaUrl("api/products/prod-123/image?variant=thumbnail", hostname))
      .toBe("/api/products/prod-123/image?variant=thumbnail");
  });

  it("keeps an opaque custom-image revision on the authenticated API origin", () => {
    const privatePath = "/api/user-personalization/background?v=0123456789abcdef";

    expect(isUserPersonalizationBackgroundPath(privatePath)).toBe(true);
    expect(resolveUserPersonalizationBackgroundUrl(privatePath, "app.megadesk.online"))
      .toBe("https://api.megadesk.online/api/user-personalization/background?v=0123456789abcdef");
  });
});
