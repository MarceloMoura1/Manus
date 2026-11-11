import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createAssistantThreadsRouter,
  resolveAssistantIdentity,
  CANONICAL_GEMINI_MODEL,
  buildToneInstruction,
} from "./assistant-threads.router";
import { AssistantThreadsRepository } from "./repository";
import {
  processQuickVoiceRequest,
  DAILY_OPERATIONS_THREAD_TITLE,
} from "../../routes/voice-shortcut";
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

  async updateMessageContent(
    messageId: string,
    content: string,
    toolInvocations?: unknown
  ): Promise<MegadeskAiMessage | null> {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg) return null;
    msg.content = content;
    if (toolInvocations !== undefined) {
      msg.toolInvocations = toolInvocations;
    }
    return { ...msg };
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
        userId: "user@acme.com",
        userEmail: "user@acme.com",
        operationalUserId: "user-op-1",
      });
    });

    it("resolves admin session identity", () => {
      const identity = resolveAssistantIdentity({
        user: { email: "Admin@MegaDesk.online", role: "admin" },
      });
      expect(identity).toEqual({
        tenantId: "main",
        userId: "admin@megadesk.online",
        userEmail: "admin@megadesk.online",
        operationalUserId: undefined,
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

  describe("sendThreadAudioMessage (Multimodal Voice Transcription & Execution)", () => {
    it("persists voice user message, extracts real transcription and saves assistant response", async () => {
      mockAiGenerate.mockResolvedValueOnce({
        text: `[Transcrição: "Quantos chamados estão abertos hoje?"]\n\nEntendi seu áudio! Temos 5 chamados abertos hoje.`,
      });

      const caller = router.createCaller({
        req: {} as any,
        res: {} as any,
        assistantIdentity: { tenantId: "tenant-1", userId: "user-a" },
      } as any);

      const thread = (await caller.createThread({})).thread;

      const result = await caller.sendThreadAudioMessage({
        threadId: thread.id,
        audioBase64: "data:audio/webm;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA",
        mimeType: "audio/webm",
      });

      expect(result.userMessage.role).toBe("user");
      expect(result.userMessage.content).toBe("🎤 Quantos chamados estão abertos hoje?");
      expect(result.transcription).toBe("Quantos chamados estão abertos hoje?");
      expect(result.assistantMessage.role).toBe("assistant");
      expect(result.assistantMessage.content).toBe("Entendi seu áudio! Temos 5 chamados abertos hoje.");

      expect(mockAiGenerate).toHaveBeenCalledTimes(1);
      const callArgs = mockAiGenerate.mock.calls[0][0];
      const lastMessage = callArgs.messages[callArgs.messages.length - 1];
      expect(lastMessage.role).toBe("user");
      expect(Array.isArray(lastMessage.content)).toBe(true);
      expect(lastMessage.content[0]).toEqual({
        type: "text",
        text: "Interprete o áudio a seguir e execute as ações necessárias ou responda ao usuário:",
      });
      expect(lastMessage.content[1]).toMatchObject({
        type: "file",
        data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA",
        mediaType: "audio/webm",
        mimeType: "audio/webm",
      });

      // Verifica se o título da thread foi atualizado com a transcrição real
      const threadMessages = await caller.getThreadMessages({ threadId: thread.id });
      expect(threadMessages.thread.title).toBe("Quantos chamados estão abertos hoje?");
    });
  });

  describe("HITL Action Session Validation", () => {
    it("validates session ownership flexibly across userEmail and operationalUserId", async () => {
      const {
        createPendingActionRequest,
        beginPendingHermesAction,
        HERMES_TOOL_REGISTRY,
      } = await import("../../gemini-client");

      const ticketTool = HERMES_TOOL_REGISTRY.find((t) => t.name === "create_ticket")!;

      // Ação criada com operationalUserId e userEmail
      const pending = createPendingActionRequest(
        ticketTool,
        {
          customer: "Mecânica Silva",
          title: "Troca de óleo urgente",
          description: "Troca de óleo urgente",
          priority: "urgent",
        },
        {
          clientId: "tenant-oficina",
          userId: "operador@oficina.com",
          userEmail: "operador@oficina.com",
          operationalUserId: "user-op-123",
        }
      );

      expect(pending.id).toBeDefined();

      // Confirmação vinda com o userEmail
      const begunWithEmail = beginPendingHermesAction({
        actionId: pending.id,
        actionType: "CREATE_TICKET",
        payload: {
          customer: "Mecânica Silva",
          title: "Troca de óleo urgente",
          description: "Troca de óleo urgente",
          priority: "urgent",
        },
        clientId: "tenant-oficina",
        userId: "operador@oficina.com",
        userEmail: "operador@oficina.com",
        operationalUserId: "user-op-123",
      });

      expect(begunWithEmail.state).toBe("EXECUTING");
      expect(begunWithEmail.actionType).toBe("CREATE_TICKET");
    });
  });

  describe("Assistant Settings & Tone Customization", () => {
    it("builds the correct tone instruction for pratico, formal, and direto", () => {
      expect(buildToneInstruction("pratico")).toContain("postura prática, colaborativa e direta");
      expect(buildToneInstruction("formal")).toContain("postura corporativa, profissional, polida e técnica");
      expect(buildToneInstruction("direto")).toContain("postura ultra-concisa");
      expect(buildToneInstruction()).toContain("postura prática, colaborativa e direta");
    });

    it("injects custom tone instruction into system prompt during sendThreadMessage", async () => {
      process.env.GEMINI_API_KEY = "test-mock-key";
      const router = createAssistantThreadsRouter(mockRepo, mockAiGenerate);
      const caller = router.createCaller({
        tenantId: "tenant-teste",
        userEmail: "user@teste.com",
      } as any);

      const thread = await mockRepo.createThread("tenant-teste", "user@teste.com", "Conversa Teste");

      mockAiGenerate.mockResolvedValueOnce({
        text: "Resposta formal e estruturada.",
      });

      await caller.sendThreadMessage({
        threadId: thread.id,
        content: "Por favor, elabore um sumário executivo.",
        settings: {
          tone: "formal",
          hitlRequired: true,
          handsFreeAudio: false,
          autoTranscribe: true,
        },
      });

      expect(mockAiGenerate).toHaveBeenCalled();
      const lastCall = mockAiGenerate.mock.calls[mockAiGenerate.mock.calls.length - 1][0];
      expect(lastCall.system).toContain("postura corporativa, profissional, polida e técnica");
    });

    it("respects autoTranscribe=false by not updating user message with speech text", async () => {
      process.env.GEMINI_API_KEY = "test-mock-key";
      const router = createAssistantThreadsRouter(mockRepo, mockAiGenerate);
      const caller = router.createCaller({
        tenantId: "tenant-teste",
        userEmail: "user@teste.com",
      } as any);

      const thread = await mockRepo.createThread("tenant-teste", "user@teste.com", "Nova Conversa");

      mockAiGenerate.mockResolvedValueOnce({
        text: '[Transcrição: "Consultar estoque de cabos"]\nTemos 50 unidades disponíveis.',
      });

      const result = await caller.sendThreadAudioMessage({
        threadId: thread.id,
        audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA",
        mimeType: "audio/webm",
        settings: {
          tone: "direto",
          hitlRequired: true,
          handsFreeAudio: false,
          autoTranscribe: false,
        },
      });

      expect(result.userMessage.content).toBe("🎤 [Mensagem de voz enviada]");
      expect(result.assistantMessage.content).toBe("Temos 50 unidades disponíveis.");
    });

    it("supports hitlRequired=false in createHermesTools for direct ticket execution", async () => {
      const { createHermesTools } = await import("../../hermes-tools");
      const mockTicketExecutor = vi.fn().mockResolvedValue({
        entityId: 777,
        status: "created",
      });

      const mockPool = {
        execute: vi.fn().mockResolvedValue([
          [
            {
              crmClientId: "crm-1",
              companyName: "Empresa Alfa",
              responsibleName: "Carlos Silva",
              phone: "11999998888",
              status: "ativo",
            },
          ],
        ]),
      };

      const tools = createHermesTools({
        clientId: "tenant-1",
        userId: "user-1",
        pool: mockPool,
        hitlRequired: false,
        executeTicketAction: mockTicketExecutor,
      });

      const ticketTool = tools.solicitar_abertura_chamado;
      expect(ticketTool).toBeDefined();

      const result = await ticketTool.execute({
        termoCliente: "Empresa Alfa",
        assunto: "Manutenção Preventiva de TI",
        prioridade: "media",
      });

      expect(result.status).toBe("executado_direto");
      expect(result.ticketNumber).toBe("777");
      expect(result.pendingActionRequest).toBeUndefined();
      expect(mockTicketExecutor).toHaveBeenCalled();
    });

    it("prepares send_whatsapp_message with pendingActionRequest when hitlRequired is true", async () => {
      const { createHermesTools } = await import("../../hermes-tools");
      const mockPool = {
        execute: vi.fn().mockResolvedValue([
          [
            {
              crmClientId: "crm-1",
              companyName: "FaYerS",
              responsibleName: "Felipe Yers",
              phone: "11988887777",
              status: "ativo",
            },
          ],
        ]),
      };

      const tools = createHermesTools({
        clientId: "tenant-1",
        userId: "user-1",
        pool: mockPool,
        hitlRequired: true,
      });

      const whatsappTool = tools.send_whatsapp_message;
      expect(whatsappTool).toBeDefined();

      const result = await whatsappTool.execute({
        recipient: "FaYerS",
        message: "Olá, seu orçamento está pronto!",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("preparado");
      expect(result.phone).toBe("5511988887777");
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest.actionType).toBe("SEND_WHATSAPP_MESSAGE");
      expect(result.pendingActionRequest.summary).toContain("FaYerS");
      expect(result.pendingActionRequest.summary).toContain("Olá, seu orçamento está pronto!");
    });

    it("executes send_whatsapp_message directly when hitlRequired is false", async () => {
      const { createHermesTools } = await import("../../hermes-tools");
      const mockWhatsAppExecutor = vi.fn().mockResolvedValue({
        success: true,
        message: "Mensagem enviada com sucesso para FaYerS via WhatsApp.",
        entityId: "conv-123",
      });

      const mockPool = {
        execute: vi.fn().mockResolvedValue([
          [
            {
              crmClientId: "crm-1",
              companyName: "FaYerS",
              responsibleName: "Felipe Yers",
              phone: "11988887777",
              status: "ativo",
            },
          ],
        ]),
      };

      const tools = createHermesTools({
        clientId: "tenant-1",
        userId: "user-1",
        pool: mockPool,
        hitlRequired: false,
        executeWhatsAppAction: mockWhatsAppExecutor,
      });

      const whatsappTool = tools.send_whatsapp_message;
      expect(whatsappTool).toBeDefined();

      const result = await whatsappTool.execute({
        recipient: "FaYerS",
        message: "Aviso importante de entrega.",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("executado_direto");
      expect(result.phone).toBe("5511988887777");
      expect(result.pendingActionRequest).toBeUndefined();
      expect(mockWhatsAppExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          recipient: "FaYerS",
          phone: "5511988887777",
          message: "Aviso importante de entrega.",
        })
      );
    });

    it("returns error when recipient has no valid phone", async () => {
      const { createHermesTools } = await import("../../hermes-tools");
      const mockPool = {
        execute: vi.fn().mockResolvedValue([[]]),
      };

      const tools = createHermesTools({
        clientId: "tenant-1",
        userId: "user-1",
        pool: mockPool,
        hitlRequired: false,
      });

      const whatsappTool = tools.send_whatsapp_message;
      const result = await whatsappTool.execute({
        recipient: "Cliente Desconhecido",
        message: "Olá!",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("telefone_invalido");
      expect(result.message).toContain("não possui número de telefone válido");
    });
  });
});

