import { conversationMediaUrl } from "./trpc-url";

export type MediaResourceDeps = {
  fetch: typeof fetch;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  mediaUrl?: typeof conversationMediaUrl;
};

export type ConversationMediaBrowserScope = {
  fetch: typeof fetch;
  URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};

/**
 * Browser Web APIs must keep their native receivers. The returned functions are
 * bound once so ConversationMediaResource can safely treat them as injectable
 * callbacks without causing an `Illegal invocation` in stricter browsers.
 */
export function createBrowserConversationMediaDeps(
  scope: ConversationMediaBrowserScope,
): Pick<MediaResourceDeps, "fetch" | "createObjectURL" | "revokeObjectURL"> {
  return {
    fetch: scope.fetch.bind(scope),
    createObjectURL: scope.URL.createObjectURL.bind(scope.URL),
    revokeObjectURL: scope.URL.revokeObjectURL.bind(scope.URL),
  };
}

export class ConversationMediaResource {
  private generation = 0;
  private objectUrl: string | null = null;
  private disposed = false;

  constructor(
    private readonly deps: MediaResourceDeps,
    private readonly onChange: (url: string | null) => void,
  ) {}

  async resolve(conversationId: string, messageId: string): Promise<void> {
    const generation = ++this.generation;
    this.clear();
    const url = (this.deps.mediaUrl ?? conversationMediaUrl)(conversationId, messageId);
    try {
      const response = await this.deps.fetch(url, { method: "GET", credentials: "include" });
      if (!response.ok) throw new Error("MEDIA_UNAVAILABLE");
      const blob = await response.blob();
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error("MEDIA_UNAVAILABLE");
      const objectUrl = this.deps.createObjectURL(blob);
      if (this.disposed || generation !== this.generation) {
        this.deps.revokeObjectURL(objectUrl);
        return;
      }
      this.objectUrl = objectUrl;
      this.onChange(objectUrl);
    } catch {
      if (!this.disposed && generation === this.generation) this.onChange(null);
    }
  }

  clear() {
    if (this.objectUrl) {
      this.deps.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.onChange(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    if (this.objectUrl) {
      this.deps.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
