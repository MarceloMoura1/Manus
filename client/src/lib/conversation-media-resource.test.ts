import { describe, expect, it, vi } from "vitest";
import { ConversationMediaResource } from "./conversation-media-resource";

const blob = () => new Blob(["synthetic"], { type: "image/png" });
function setup(response: any = { ok: true, blob: async () => blob() }) { const fetch = vi.fn().mockResolvedValue(response), createObjectURL = vi.fn(() => "blob:synthetic"), revokeObjectURL = vi.fn(), changes: Array<string|null> = []; return { fetch, createObjectURL, revokeObjectURL, changes, resource: new ConversationMediaResource({ fetch, createObjectURL, revokeObjectURL, mediaUrl: (c,m) => `https://api.megadesk.online/api/conversations/${c}/messages/${m}/media` }, x => changes.push(x)) }; }
describe("ConversationMediaResource", () => {
  it("uses canonical authenticated GET and resolves a blob", async () => { const x=setup(); await x.resource.resolve("conv-a","msg-a"); expect(x.fetch).toHaveBeenCalledWith("https://api.megadesk.online/api/conversations/conv-a/messages/msg-a/media",{method:"GET",credentials:"include"}); expect(x.changes).toContain("blob:synthetic"); });
  it("revokes on replacement and dispose", async () => { const x=setup(); await x.resource.resolve("c","a"); await x.resource.resolve("c","b"); x.resource.dispose(); expect(x.revokeObjectURL).toHaveBeenCalledTimes(2); });
  it("sanitizes failures without an object URL or retry", async () => { const x=setup({ok:false,blob:async()=>blob()}); await x.resource.resolve("c","m"); expect(x.createObjectURL).not.toHaveBeenCalled(); expect(x.changes.at(-1)).toBe(null); expect(x.fetch).toHaveBeenCalledTimes(1); });
  it("revokes a late response after dispose", async () => { let done!: (x:any)=>void; const x=setup(); x.fetch.mockReturnValue(new Promise(r=>done=r)); const work=x.resource.resolve("c","m"); x.resource.dispose(); done({ok:true,blob:async()=>blob()}); await work; expect(x.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic"); });
});
