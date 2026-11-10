import type { Express, Request, Response } from "express";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, isStepCount } from "ai";
import { resolveOperationalSessionReadOnly } from "../_core/megadesk-session";
import { createHermesTools } from "../hermes-tools";
import {
  AssistantThreadsRepository,
  assistantThreadsRepository,
} from "../modules/assistant/repository";
import {
  CANONICAL_GEMINI_MODEL,
  extractToolMetadata,
  resolveGeminiApiKey,
  stripAudioDataUrlPrefix,
} from "../modules/assistant/assistant-threads.router";

export const DAILY_OPERATIONS_THREAD_TITLE = "Operações do Dia";

export interface QuickVoiceRequestPayload {
  audioBase64?: string;
  mimeType?: string;
  text?: string;
  message?: string;
  prompt?: string;
  tenantId?: string;
  clientId?: string;
  userId?: string;
}

export interface QuickVoiceResult {
  success: boolean;
  threadId?: string;
  speechResponse: string;
  error?: string;
}

export async function resolveQuickVoiceIdentity(
  req: Request,
  body: QuickVoiceRequestPayload
): Promise<{ tenantId: string; userId: string } | null> {
  // 1. Tenta sessão operacional MegaDesk via cookie
  try {
    const operational = await resolveOperationalSessionReadOnly(req as any);
    if (operational?.tenantId && (operational.userId || operational.userEmail)) {
      return {
        tenantId: String(operational.tenantId).trim(),
        userId: String(operational.userId || operational.userEmail).trim().toLowerCase(),
      };
    }
  } catch {
    // continua para resolução via header / body do atalho mobile
  }

  // 2. Headers ou body do atalho rápido (iOS Shortcuts / Android Tasker / Webhook)
  const headerTenant =
    (typeof req.headers["x-tenant-id"] === "string" && req.headers["x-tenant-id"]) ||
    (typeof req.headers["x-client-id"] === "string" && req.headers["x-client-id"]) ||
    "";
  const headerUser =
    (typeof req.headers["x-user-id"] === "string" && req.headers["x-user-id"]) ||
    (typeof req.headers["x-user-email"] === "string" && req.headers["x-user-email"]) ||
    "";

  const tenantId = String(body.tenantId || body.clientId || headerTenant || "").trim();
  const userId = String(body.userId || headerUser || "operador-mobile").trim().toLowerCase();

  if (tenantId) {
    return { tenantId, userId };
  }

  return null;
}

export async function processQuickVoiceRequest(
  payload: QuickVoiceRequestPayload & { tenantId: string; userId: string },
  repo: AssistantThreadsRepository = assistantThreadsRepository,
  aiGenerator: typeof generateText = generateText
): Promise<QuickVoiceResult> {
  const { tenantId, userId } = payload;
  const rawAudio = typeof payload.audioBase64 === "string" ? payload.audioBase64.trim() : "";
  const rawText = String(payload.text || payload.message || payload.prompt || "").trim();

  if (!rawAudio && !rawText) {
    return {
      success: false,
      speechResponse: "Nenhum áudio ou comando de texto foi recebido pelo atalho.",
      error: "EMPTY_INPUT",
    };
  }

  // 1. Localiza ou cria automaticamente a thread "Operações do Dia"
  const existingThreads = await repo.listThreads(tenantId, userId);
  let dailyThread = existingThreads.find(
    (t) => t.title.trim().toLowerCase() === DAILY_OPERATIONS_THREAD_TITLE.toLowerCase()
  );

  if (!dailyThread) {
    dailyThread = await repo.createThread(tenantId, userId, DAILY_OPERATIONS_THREAD_TITLE);
  }

  // 2. Registra a mensagem do usuário na thread
  const isAudioInput = rawAudio.length > 0;
  const cleanBase64 = isAudioInput ? stripAudioDataUrlPrefix(rawAudio) : "";
  const normalizedMimeType = (payload.mimeType || "audio/webm").trim();

  const userDisplayContent = isAudioInput
    ? rawText
      ? `🎤 [Atalho Mãos-Livres]: ${rawText}`
      : "🎤 [Atalho Mãos-Livres: Comando de voz]"
    : rawText;

  const userMessage = await repo.saveMessage(
    dailyThread.id,
    "user",
    userDisplayContent,
    isAudioInput ? { type: "quick-voice", mimeType: normalizedMimeType } : { type: "quick-text" }
  );

  await repo.touchThread(dailyThread.id);

  // 3. Verifica credencial Gemini
  const apiKey = await resolveGeminiApiKey(tenantId);
  if (!apiKey) {
    const noKeySpeech = "A chave da API Gemini não está configurada para executar o comando de voz.";
    await repo.saveMessage(dailyThread.id, "assistant", noKeySpeech);
    return {
      success: false,
      threadId: dailyThread.id,
      speechResponse: noKeySpeech,
      error: "MISSING_API_KEY",
    };
  }

  // 4. Carrega histórico recente da thread "Operações do Dia"
  const allMessages = await repo.getThreadMessages(dailyThread.id);
  const previousMessages = allMessages.filter((m) => m.id !== userMessage.id).slice(-10);

  const historyPrompt = previousMessages.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as
      | "user"
      | "assistant"
      | "system",
    content: m.content,
  }));

  const promptMessages: any[] = isAudioInput
    ? [
        ...historyPrompt,
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text:
                rawText ||
                "Interprete o áudio a seguir enviado pelo atalho mãos-livres de campo/oficina, execute as ferramentas necessárias e retorne uma resposta concisa ideal para leitura em voz alta:",
            },
            {
              type: "file" as const,
              data: cleanBase64,
              mediaType: normalizedMimeType,
              mimeType: normalizedMimeType,
            },
          ],
        },
      ]
    : [
        ...historyPrompt,
        {
          role: "user" as const,
          content: rawText,
        },
      ];

  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const targetModel = process.env.GEMINI_MODEL || CANONICAL_GEMINI_MODEL;
    const tenantTools = createHermesTools({ clientId: tenantId, userId });

    const systemInstruction = `Você é o Copiloto Mãos-Livres de Operações do MegaDesk.
O usuário está em campo ou na oficina utilizando um atalho rápido de voz.
Execute imediatamente as ferramentas necessárias do tenant (consultar CRM, vendas, chamados ou preparar abertura de chamado) e responda em português do Brasil com uma frase objetiva, natural e direta (sem markdown complexo), ideal para ser lida em voz alta pelo celular.`;

    const aiResult = await aiGenerator({
      model: google(targetModel),
      system: systemInstruction,
      messages: promptMessages,
      tools: tenantTools,
      stopWhen: isStepCount(5),
    });

    const toolMetadata = extractToolMetadata(aiResult);
    const pendingReq = toolMetadata?.pendingActionRequest as any;
    const speechResponse =
      aiResult.text?.trim() ||
      (pendingReq?.summary
        ? `Ação preparada com sucesso: ${pendingReq.summary}.`
        : "Comando processado com sucesso na thread Operações do Dia.");

    await repo.saveMessage(dailyThread.id, "assistant", speechResponse, toolMetadata);

    return {
      success: true,
      threadId: dailyThread.id,
      speechResponse,
    };
  } catch (error: any) {
    console.error(`[QuickVoiceShortcut] Erro ao processar atalho de voz tenant=${tenantId}:`, error);
    const errorSpeech = `Não foi possível concluir o comando de voz no momento: ${error?.message || "Falha no provedor de IA."}`;
    await repo.saveMessage(dailyThread.id, "assistant", errorSpeech);
    return {
      success: false,
      threadId: dailyThread.id,
      speechResponse: errorSpeech,
      error: "AI_PROVIDER_ERROR",
    };
  }
}

export function registerVoiceShortcutRoutes(app: Express): void {
  app.post("/api/v1/assistant/quick-voice", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as QuickVoiceRequestPayload;
      const identity = await resolveQuickVoiceIdentity(req, body);

      if (!identity) {
        return res.status(401).json({
          success: false,
          speechResponse: "Sessão ou identificação do tenant não informada para o atalho de voz.",
          error: "UNAUTHORIZED",
        });
      }

      const result = await processQuickVoiceRequest({
        ...body,
        tenantId: identity.tenantId,
        userId: identity.userId,
      });

      const statusCode = result.success ? 200 : result.error === "EMPTY_INPUT" ? 400 : 200;
      return res.status(statusCode).json(result);
    } catch (error: any) {
      console.error("[QuickVoiceShortcut] Erro inesperado na rota /api/v1/assistant/quick-voice:", error);
      return res.status(500).json({
        success: false,
        speechResponse: "Erro interno ao processar o atalho de voz.",
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  });
}

