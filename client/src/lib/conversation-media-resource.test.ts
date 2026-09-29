import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationMedia } from "../components/ConversationMedia";
import {
  ConversationMediaResource,
  createBrowserConversationMediaDeps,
  type ConversationMediaBrowserScope,
} from "./conversation-media-resource";

const blob = (type = "image/png") => new Blob(["synthetic"], { type });

function setup(response: any = { ok: true, blob: async () => blob() }) {
  const fetch = vi.fn().mockResolvedValue(response);
  const createObjectURL = vi.fn(() => "blob:synthetic");
  const revokeObjectURL = vi.fn();
  const changes: Array<string | null> = [];
  return {
    fetch,
    createObjectURL,
    revokeObjectURL,
    changes,
    resource: new ConversationMediaResource(
      {
        fetch,
        createObjectURL,
        revokeObjectURL,
        mediaUrl: (conversationId, messageId) =>
          `https://api.megadesk.online/api/conversations/${conversationId}/messages/${messageId}/media`,
      },
      value => changes.push(value),
    ),
  };
}

describe("ConversationMediaResource", () => {
  it("binds native browser APIs to their required receivers", async () => {
    let scope!: ConversationMediaBrowserScope;
    const urlApi = {
      createObjectURL: vi.fn(function (this: unknown, value: Blob) {
        if (this !== urlApi) throw new TypeError("Illegal invocation");
        expect(value.type).toBe("audio/ogg");
        return "blob:receiver-safe";
      }),
      revokeObjectURL: vi.fn(function (this: unknown) {
        if (this !== urlApi) throw new TypeError("Illegal invocation");
      }),
    };
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== scope) throw new TypeError("Illegal invocation");
      return Promise.resolve({ ok: true, blob: async () => blob("audio/ogg") } as Response);
    });
    scope = {
      fetch: nativeFetch as unknown as typeof fetch,
      URL: urlApi as unknown as ConversationMediaBrowserScope["URL"],
    };
    const changes: Array<string | null> = [];
    const resource = new ConversationMediaResource(
      {
        ...createBrowserConversationMediaDeps(scope),
        mediaUrl: () => "/api/conversations/c/messages/m/media",
      },
      value => changes.push(value),
    );

    await resource.resolve("c", "m");

    expect(nativeFetch).toHaveBeenCalledWith("/api/conversations/c/messages/m/media", {
      method: "GET",
      credentials: "include",
    });
    expect(changes.at(-1)).toBe("blob:receiver-safe");
    resource.dispose();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:receiver-safe");
  });

  it("uses the canonical authenticated GET and resolves a blob", async () => {
    const x = setup();
    await x.resource.resolve("conv-a", "msg-a");
    expect(x.fetch).toHaveBeenCalledWith(
      "https://api.megadesk.online/api/conversations/conv-a/messages/msg-a/media",
      { method: "GET", credentials: "include" },
    );
    expect(x.changes.at(-1)).toBe("blob:synthetic");
  });

  it.each([
    ["audio", "audio/ogg"],
    ["image", "image/png"],
    ["video", "video/mp4"],
    ["document", "application/pdf"],
  ])("resolves %s blobs through the common boundary", async (_kind, mime) => {
    const x = setup({ ok: true, blob: async () => blob(mime) });
    await x.resource.resolve("c", `m-${_kind}`);
    expect(x.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: mime }));
    expect(x.changes.at(-1)).toBe("blob:synthetic");
  });

  it("loads again after dispose and remount without relying on an earlier cache", async () => {
    const first = setup();
    await first.resource.resolve("c", "m");
    first.resource.dispose();

    const remounted = setup();
    await remounted.resource.resolve("c", "m");

    expect(first.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
    expect(remounted.fetch).toHaveBeenCalledTimes(1);
    expect(remounted.changes.at(-1)).toBe("blob:synthetic");
  });

  it("disposing one instance does not revoke another instance's URL", async () => {
    let next = 0;
    const revokeObjectURL = vi.fn();
    const deps = {
      fetch: vi.fn().mockResolvedValue({ ok: true, blob: async () => blob() }),
      createObjectURL: vi.fn(() => `blob:media-${++next}`),
      revokeObjectURL,
      mediaUrl: (conversationId: string, messageId: string) => `${conversationId}/${messageId}`,
    };
    const first = new ConversationMediaResource(deps, () => undefined);
    const secondChanges: Array<string | null> = [];
    const second = new ConversationMediaResource(deps, value => secondChanges.push(value));
    await Promise.all([first.resolve("c", "one"), second.resolve("c", "two")]);

    first.dispose();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:media-2");
    expect(secondChanges.at(-1)).toBe("blob:media-2");
    second.dispose();
  });

  it("removes an earlier fallback after a later successful resolution", async () => {
    const x = setup();
    x.fetch
      .mockResolvedValueOnce({ ok: false, blob: async () => blob() })
      .mockResolvedValueOnce({ ok: true, blob: async () => blob("audio/webm") });
    await x.resource.resolve("c", "m");
    expect(x.changes.at(-1)).toBe(null);

    await x.resource.resolve("c", "m");

    expect(x.changes.at(-1)).toBe("blob:synthetic");
  });

  it("keeps the newest conversation/message and revokes a late stale result", async () => {
    let finishFirst!: (response: any) => void;
    const x = setup();
    x.createObjectURL.mockReturnValueOnce("blob:newest").mockReturnValueOnce("blob:stale");
    x.fetch
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, blob: async () => blob("video/mp4") });
    const staleWork = x.resource.resolve("old-conversation", "old-message");
    await x.resource.resolve("new-conversation", "new-message");
    finishFirst({ ok: true, blob: async () => blob("audio/ogg") });
    await staleWork;

    expect(x.changes.at(-1)).toBe("blob:newest");
    expect(x.revokeObjectURL).toHaveBeenCalledWith("blob:stale");
    expect(x.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.megadesk.online/api/conversations/new-conversation/messages/new-message/media",
      { method: "GET", credentials: "include" },
    );
  });

  it("revokes on replacement and dispose", async () => {
    const x = setup();
    await x.resource.resolve("c", "a");
    await x.resource.resolve("c", "b");
    x.resource.dispose();
    expect(x.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("sanitizes failures without an object URL or retry", async () => {
    const x = setup({ ok: false, blob: async () => blob() });
    await x.resource.resolve("c", "m");
    expect(x.createObjectURL).not.toHaveBeenCalled();
    expect(x.changes.at(-1)).toBe(null);
    expect(x.fetch).toHaveBeenCalledTimes(1);
  });

  it("revokes a late response after dispose without publishing stale state", async () => {
    let done!: (response: any) => void;
    const x = setup();
    x.fetch.mockReturnValue(new Promise(resolve => { done = resolve; }));
    const work = x.resource.resolve("c", "m");
    x.resource.dispose();
    done({ ok: true, blob: async () => blob() });
    await work;
    expect(x.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
    expect(x.changes).toEqual([null]);
  });
});

describe("ConversationMedia consumers", () => {
  it.each([
    ["audio", "audio", "src=\"blob:audio\""],
    ["image", "img", "src=\"blob:image\""],
    ["video", "video", "src=\"blob:video\""],
    ["document", "a", "href=\"blob:document\""],
  ])("renders resolved %s media instead of its fallback", (type, element, attribute) => {
    const html = renderToStaticMarkup(
      React.createElement(ConversationMedia, {
        conversationId: "conversation-a",
        message: {
          id: `message-${type}`,
          type,
          mediaData: `blob:${type}`,
          fileName: type === "document" ? "arquivo.pdf" : undefined,
        },
        fallback: React.createElement("span", null, "Mídia indisponível"),
      }),
    );

    expect(html).toContain(`<${element}`);
    expect(html).toContain(attribute);
    expect(html).not.toContain("Mídia indisponível");
  });
});
