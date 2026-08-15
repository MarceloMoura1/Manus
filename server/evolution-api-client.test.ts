import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), create: vi.fn() }));
vi.mock("axios", () => ({
  default: {
    create: (config: object) => {
      mocked.create(config);
      return { post: mocked.post, get: mocked.get, interceptors: { response: { use: vi.fn() } } };
    },
  },
}));

import { EvolutionAPIClient } from "./evolution-api-client";

describe("Evolution API client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("configures a finite request timeout", () => {
    const client = new EvolutionAPIClient({ baseUrl: "http://localhost:8081", apiKey: "fake-key" });
    expect(client).toBeDefined();
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000 }));
  });

  it("propagates network and timeout failures", async () => {
    mocked.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = new EvolutionAPIClient({ baseUrl: "http://localhost:8081", apiKey: "fake-key" });
    await expect(client.sendMessage("instance", "token", { number: "5511999999999", text: "Olá" })).rejects.toThrow("ECONNREFUSED");
  });

  it("rejects an invalid provider response", async () => {
    mocked.post.mockResolvedValueOnce({ data: { status: "SERVER_ACK" } });
    const client = new EvolutionAPIClient({ baseUrl: "http://localhost:8081", apiKey: "fake-key" });
    await expect(client.sendMessage("instance", "token", { number: "5511999999999", text: "Olá" })).rejects.toThrow("Resposta inválida");
  });

  it("returns a valid provider response", async () => {
    const response = { key: { id: "message-a", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true }, status: "SERVER_ACK", message: "Olá" };
    mocked.post.mockResolvedValueOnce({ data: response });
    const client = new EvolutionAPIClient({ baseUrl: "http://localhost:8081", apiKey: "fake-key" });
    await expect(client.sendMessage("instance", "token", { number: "5511999999999", text: "Olá" })).resolves.toEqual(response);
  });
});
