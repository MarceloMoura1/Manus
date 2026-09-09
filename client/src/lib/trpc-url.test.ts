import { describe, expect, it } from "vitest";
import { trpcBaseUrl, trpcProcedureUrl, userPersonalizationBackgroundUrl } from "./trpc-url";

describe("tRPC transport URL", () => {
  it.each(["app.megadesk.online", "admin.megadesk.online", "api.megadesk.online"])(
    "usa o host da API em produção para preservar a sessão (%s)",
    hostname => {
      expect(trpcBaseUrl(hostname)).toBe("https://api.megadesk.online/api/trpc");
      expect(trpcProcedureUrl("megadesk.sendMessage", hostname))
        .toBe("https://api.megadesk.online/api/trpc/megadesk.sendMessage");
      expect(userPersonalizationBackgroundUrl(hostname))
        .toBe("https://api.megadesk.online/api/user-personalization/background");
    },
  );

  it.each(["localhost", "127.0.0.1"])("mantém chamadas locais same-origin (%s)", hostname => {
    expect(trpcBaseUrl(hostname)).toBe("/api/trpc");
    expect(trpcProcedureUrl("megadesk.sendAttachment", hostname))
      .toBe("/api/trpc/megadesk.sendAttachment");
  });
});
