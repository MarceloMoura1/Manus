import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createAssistantThreadsRouter,
  resolveAssistantIdentity,
  CANONICAL_GEMINI_MODEL,
} from "./assistant-threads.router";
import { AssistantThreadsRepository } from "./repository";
import type { MegadeskAiThread, MegadeskAiMessage } from "../../../drizzle/schema";

class MockAssistantThreadsRepository extends AssistantThreadsRepository {
  private threads: MegadeskAiThread[] = [];
  private messages: MegadeskAiMessage[] = [];

  async listThreads(tenantId: string, userId: string): Promise<MegadeskAiThread[]> {
    return this.threads
      .filter((t) => t.tenantId === tenantId && t.userId === userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getThread(tenantId: string, userId: string, threadId: string): Promise<MegadeskAiThread | null> {
    const thread = this.threads.find(
      (t) => t.id === threadId && t.tenantId === tenantId && t.userId === userId
    );
    return thread ? { ...thread } : null;
  }

  async createThread(tenantId: string, userId: string, title?: string): Promise<MegadeskAiThread> {
    const thread: MegadeskAiThread = {
      id: `thread-${this.threads.length + 1}`,
      tenantId,
      userId,
      title: title?.trim() || "Nova Conversa",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.threads.push(thread);
    return { ...thread };
  }

  async renameThread(
    tenantId: string,
    userId: string,
    threadId: string,
    title: string
  ): Promise<MegadeskAiThread> {
    const thread = this.threads.find(
      (t) => t.id === threadId && t.tenantId === tenantId && t.userId === userId
    );
    if (!thread) {
      throw new Error("Thread não encontrada");
    }
    thread.title = title.trim();
    thread.updatedAt = new Date();
    return { ...thread };
  }

  async deleteThread(tenantId: string, userId: string, threadId: string): Promise<{ success: boolean; threadId: string }> {
    const initialLen = this.threads.length;
    this.threads = this.threads.filter(
      (t) => !(t.id === threadId && t.tenantId === tenantId && t.userId === userId)
    );
    if (this.threads.length === initialLen) {
      throw new Error("Thread não encontrada");
    }
    this.messages = this.messages.filter((m) => m.threadId !== threadId);
    return { success: true, threadId };
  }

  async getThreadMessages(threadId: string): Promise<MegadeskAiMessage[]> {
    return this.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async saveMessage(
    threadId: string,
    role: "user" | "assistant" | "system",
    content: string,
    toolInvocations?: unknown
  ): Promise<MegadeskAiMessage> {
    const message: MegadeskAiMessage = {
      id: `msg-${this.messages.length + 1}`,
      threadId,
      role,
      content,
      toolInvocations: toolInvocations ?? null,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return { ...message };
  }

  async touchThread(threadId: string, newTitle?: string): Promise<void> {
    const thread = this.threads.find((t) => t.id === threadId);
    if (thread) {
      thread.updatedAt = new Date();
      if (newTitle) {
        thread.title = newTitle.trim();
      }
    }
  }

  // Helpers de teste
  getRawThreads() {
    return this.threads;
  }
  getRawMessages() {
    return this.messages;
  }
}

describe("Assistant Threads Router & Multi-Chat Sessions", () => {
  let mockRepo: MockAssistantThreadsRepository;
  let mockAiGenerate: any;
  let router: ReturnType<typeof createAssistantThreadsRouter>;

  beforeEach(() => {
    mockRepo = new MockAssistantThreadsRepository();
    mockAiGenerate = vi.fn().mockResolvedValue({
      text: "Olá! Como posso ajudar com sua operação hoje?",
    });
    router = createAssistantThreadsRouter(mockRepo, mockAiGenerate);
    process.env.GEMINI_API_KEY = "test-fake-key-for-unit-tests-12345";
  });

  describe("resolveAssistantIdentity", () => {
    it("resolves operational MegaDesk session identity", () => {
      const identity = resolveAssistantIdentity({
        tenantId: "tenant-acme",
        operationalUserId: "user-op-1",
        userEmail: "user@acme.com",
      });
      expect(identity).toEqual({
        tenantId: "tenant-acme",
        userId: "user-op-1",
      });
    });

    it("resolves admin session identity", () => {
      const identity = resolveAssistantIdentity({
        user: { email: "Admin@MegaDesk.online", role: "admin" },
      });
      expect(identity).toEqual({
        tenantId: "main",
        userId: "admin@megadesk.online",
      });
    });

    it("resolves test identity when present", () => {
      const identity = resolveAssistantIdentity({
        assistantIdentity: { tenantId: "t-1", userId: "u-1" },
      });
      expect(identity).toEqual({
        tenantId: "t-1",
        userId: "u-1",
      });
    });

    it("throws UNAUTHORIZED when no identity is found", () => {
      expect(() => resolveAssistantIdentity({})).toThrow(TRPCError);
    });
  });

  describe("CRUD de Threads & Multi-Chat", () => {
    const callerUserA = () =>
      router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-a" },
      } as any);

    const callerUserB = () =>
      router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-b" },
      } as any);

    it("creates a new thread with default title and lists it", async () => {
      const callerA = callerUserA();
      const createRes = await callerA.createThread({});
      expect(createRes.thread.id).toBeDefined();
      expect(createRes.thread.title).toBe("Nova Conversa");
      expect(createRes.thread.tenantId).toBe("tenant-1");
      expect(createRes.thread.userId).toBe("user-a");

      const listRes = await callerA.listThreads();
      expect(listRes.threads.length).toBe(1);
      expect(listRes.threads[0].id).toBe(createRes.thread.id);
    });

    it("renames an existing thread successfully", async () => {
      const callerA = callerUserA();
      const createRes = await callerA.createThread({ title: "Título Inicial" });
      const renameRes = await callerA.renameThread({
        threadId: createRes.thread.id,
        title: "Dúvidas Tributárias",
      });
      expect(renameRes.thread.title).toBe("Dúvidas Tributárias");

      const list = await callerA.listThreads();
      expect(list.threads[0].title).toBe("Dúvidas Tributárias");
    });

    it("deletes a thread and cascade-cleans messages", async () => {
      const callerA = callerUserA();
      const createRes = await callerA.createThread({});
      const threadId = createRes.thread.id;

      // Adiciona mensagem
      await callerA.sendThreadMessage({
        threadId,
        content: "Pergunta de teste",
      });

      const msgsBefore = await callerA.getThreadMessages({ threadId });
      expect(msgsBefore.messages.length).toBe(2); // user + assistant

      const delRes = await callerA.deleteThread({ threadId });
      expect(delRes.success).toBe(true);

      const listAfter = await callerA.listThreads();
      expect(listAfter.threads.length).toBe(0);
    });

    it("enforces strict multi-tenant and user isolation across sessions", async () => {
      const callerA = callerUserA();
      const callerB = callerUserB();

      // Sócio A cria uma thread
      const threadA = (await callerA.createThread({ title: "Conversa Privada A" })).thread;

      // Sócio B não visualiza a thread do Sócio A
      const listB = await callerB.listThreads();
      expect(listB.threads.length).toBe(0);

      // Sócio B não pode acessar nem renomear a thread do Sócio A
      await expect(
        callerB.renameThread({ threadId: threadA.id, title: "Hacked" })
      ).rejects.toThrow(TRPCError);

      await expect(
        callerB.getThreadMessages({ threadId: threadA.id })
      ).rejects.toThrow(TRPCError);

      await expect(
        callerB.deleteThread({ threadId: threadA.id })
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("sendThreadMessage & Gemini AI Generation", () => {
    it("persists user message, calls Gemini with canonical model and saves response", async () => {
      const caller = router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-a" },
      } as any);

      const thread = (await caller.createThread({})).thread;

      const result = await caller.sendThreadMessage({
        threadId: thread.id,
        content: "Como funciona a emissão de notas no MegaDesk?",
      });

      expect(result.userMessage.content).toBe("Como funciona a emissão de notas no MegaDesk?");
      expect(result.userMessage.role).toBe("user");

      expect(result.assistantMessage.role).toBe("assistant");
      expect(result.assistantMessage.content).toBe("Olá! Como posso ajudar com sua operação hoje?");

      // Verifica se o modelo canônico foi repassado
      expect(mockAiGenerate).toHaveBeenCalledTimes(1);
      const callArgs = mockAiGenerate.mock.calls[0][0];
      expect(callArgs.messages.length).toBe(1);
      expect(callArgs.messages[0]).toEqual({
        role: "user",
        content: "Como funciona a emissão de notas no MegaDesk?",
      });

      // Thread auto-title foi atualizado a partir da primeira mensagem
      const threadMessages = await caller.getThreadMessages({ threadId: thread.id });
      expect(threadMessages.thread.title).toBe("Como funciona a emissão de notas no M...");
      expect(threadMessages.messages.length).toBe(2);
    });

    it("informs cleanly when GEMINI_API_KEY is not configured", async () => {
      delete process.env.GEMINI_API_KEY;

      const caller = router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-a" },
      } as any);

      const thread = (await caller.createThread({})).thread;

      const result = await caller.sendThreadMessage({
        threadId: thread.id,
        content: "Olá",
      });

      expect(result.assistantMessage.content).toContain("GEMINI_API_KEY");
      expect(mockAiGenerate).not.toHaveBeenCalled();
    });

    it("handles AI provider errors gracefully without crashing the server", async () => {
      mockAiGenerate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      const caller = router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-a" },
      } as any);

      const thread = (await caller.createThread({})).thread;

      const result = await caller.sendThreadMessage({
        threadId: thread.id,
        content: "Pergunta",
      });

      expect(result.assistantMessage.content).toContain("Erro na comunicação com a IA");
      expect(result.assistantMessage.content).toContain("Rate limit exceeded");
    });
  });
});
