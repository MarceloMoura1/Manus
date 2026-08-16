import { describe, expect, it } from "vitest";

import { parseMediaDataUrl } from "./media-data";

describe("parseMediaDataUrl", () => {
  it("aceita áudio real do MediaRecorder com codec Opus", () => {
    expect(parseMediaDataUrl(
      "data:audio/webm;codecs=opus;base64,AQ==",
      "audio/webm;codecs=opus",
    )).toEqual({ base64: "AQ==", mimeType: "audio/webm" });
  });

  it("aceita mídia sem parâmetros", () => {
    expect(parseMediaDataUrl("data:image/png;base64,AQ==", "image/png"))
      .toEqual({ base64: "AQ==", mimeType: "image/png" });
  });

  it("rejeita MIME declarado diferente do conteúdo", () => {
    expect(parseMediaDataUrl("data:image/png;base64,AQ==", "audio/webm")).toBeNull();
  });
});
