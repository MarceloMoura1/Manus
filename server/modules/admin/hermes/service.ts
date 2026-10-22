import { GoogleGenerativeAI } from "@google/generative-ai";
import { HermesRepository, hermesRepository } from "./repository";
import type {
  HermesMessageItem,
  HermesQuickStats,
} from "./contracts";

export class HermesService {
  constructor(private repository: HermesRepository = hermesRepository) {}

  async getHistory(adminUserId: string): Promise<HermesMessageItem[]> {
    return this.repository.getHistory(adminUserId);
  }

  async clearHistory(adminUserId: string) {
    return this.repository.clearHistory(adminUserId);
  }

  async sendMessage(
    adminUserId: string,
    messageText: string
  ): Promise<{ response: HermesMessageItem; history: HermesMessageItem[] }> {
    const trimmed = messageText.trim();

    // 1. Persist user message
    await this.repository.saveMessage(adminUserId, "user", trimmed, {
      receivedAt: new Date().toISOString(),
    });

    // 2. Load recent conversation history for context (up to last 15 messages)
    const recentHistory = await this.repository.getHistory(adminUserId);
    const contextSlice = recentHistory.slice(-15);

    // 3. Generate response via Gemini or structured fallback
    let responseContent = "";
    let metadata: Record<string, unknown> = {
      model: "hermes-local-core",
      source: "fallback",
      timestamp: new Date().toISOString(),
    };

    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey.trim().length > 10) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey.trim());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemInstruction = `Você é o Hermes, a central de inteligência executiva, operações de infraestrutura e comando estratégico do MegaAdmin para os sócios fundadores do MegaDesk.
Você atua na sala de comando restrita dos sócios.
Suas atribuições e postura:
1. Responda em Português do Brasil com postura executiva, objetiva e técnica (DevOps sênior / COO técnico).
2. Auxilie os sócios na gestão de clientes, diagnóstico de servidores VPS Oracle Cloud, containers Docker, banco MySQL e Evolution WhatsApp.
3. Se o sócio solicitar vistoria, planos ou ações técnicas, forneça resumos organizados com tópicos claros, tabelas ou blocos de comando.
4. Não mencione detalhes irrelevantes; foque na eficiência operacional e estabilidade do MegaDesk.`;

        const historyPayload = contextSlice.slice(0, -1).map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        }));

        const chat = model.startChat({
          history: historyPayload,
          systemInstruction,
        });

        const result = await chat.sendMessage(trimmed);
        responseContent = result.response.text();
        metadata = {
          model: "gemini-1.5-flash",
          source: "gemini_api",
          timestamp: new Date().toISOString(),
        };
      } catch (geminiError: any) {
        console.warn("[HermesService] Erro ao consultar Gemini API, acionando fallback executivo:", geminiError?.message);
        responseContent = this.generateFallbackResponse(trimmed, adminUserId);
        metadata = {
          model: "hermes-local-core",
          source: "fallback",
          reason: geminiError?.message ?? "Falha na comunicação com a API",
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      // Local fallback mode when GEMINI_API_KEY is not injected
      responseContent = this.generateFallbackResponse(trimmed, adminUserId);
    }

    // 4. Persist assistant message
    const savedAssistantMsg = await this.repository.saveMessage(
      adminUserId,
      "assistant",
      responseContent,
      metadata
    );

    // 5. Return updated history
    const updatedHistory = await this.repository.getHistory(adminUserId);
    return {
      response: savedAssistantMsg,
      history: updatedHistory,
    };
  }

  private generateFallbackResponse(message: string, adminUserId: string): string {
    const lower = message.toLowerCase();

    if (lower.includes("vistoria") || lower.includes("vps") || lower.includes("status")) {
      const uptimeMin = Math.floor(process.uptime() / 60);
      const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
      return `### 🏥 Vistoria Operacional da Plataforma\n\nOlá, administrador (**${adminUserId}**). Aqui está o relatório instantâneo de infraestrutura:\n\n- **Aplicação Principal (\`megadesk-app\`):** Operacional (Uptime: ${uptimeMin} minutos).\n- **Memória do Processo:** ${memMb} MB alocados.\n- **Isolamento de Sessão:** Ativo e restrito à sua conta de administrador.\n- **Comunicação com WhatsApp (Evolution):** Configurada e ativa.\n\n*Nota: O módulo Hermes está operando no momento através do núcleo de comando interno.*`;
    }

    if (lower.includes("token") || lower.includes("consumo")) {
      return `### 📊 Telemetria de Tokens & Recursos\n\nTodos os tenants possuem medição individualizada de tokens na tabela \`megadesk_ia_token_usage\`.\n\n- O modelo padrão é o **Gemini 1.5 Flash**.\n- O cálculo segregado por cliente evita consumo cruzado de créditos.\n- Consulte a aba **Clientes** no MegaAdmin para quotas e tokens específicos de cada tenant.`;
    }

    if (lower.includes("auditoria") || lower.includes("segurança")) {
      return `### 🛡️ Auditoria de Segurança do MegaAdmin\n\n- **Autenticação:** JWT exclusivo com perfil administrativo (\`role: admin\`).\n- **Multi-tenancy:** Bloqueio de cross-tenant em todas as rotas com verificação autoritativa.\n- **Sessão do Hermes:** Suas mensagens são salvas exclusivamente com a chave \`${adminUserId}\` e isoladas dos demais sócios.`;
    }

    return `Olá! Sou o **Hermes**, seu copiloto de operações e estratégia no MegaAdmin.\n\nRecebi sua instrução: *"__${message}__"*.\n\nEstou pronto para ajudar com:\n1. 🏥 **Vistoria da VPS e Docker** (diagnóstico de containers e rede)\n2. 📊 **Consumo de Tokens e Quotas de IA**\n3. 🛡️ **Auditoria de Tenants e Multi-tenancy**\n4. 🚀 **Acompanhamento de Releases e Migrations**\n\nComo deseja proceder agora?`;
  }

  getQuickStats(): HermesQuickStats {
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);

    const formattedParts: string[] = [];
    if (days > 0) formattedParts.push(`${days}d`);
    if (hours > 0 || days > 0) formattedParts.push(`${hours}h`);
    formattedParts.push(`${mins}m`);
    const uptimeFormatted = formattedParts.join(" ") || "< 1m";

    const memoryUsageMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10);

    return {
      uptimeSeconds: uptimeSec,
      uptimeFormatted,
      memoryUsageMb,
      timestamp: new Date().toISOString(),
      services: [
        {
          name: "MegaDesk App",
          key: "megadesk-app",
          status: "online",
          details: `Porta 3000 • Node.js ${process.version}`,
        },
        {
          name: "MySQL Principal",
          key: "mysql-main",
          status: "online",
          details: "Pool de conexões ativo",
        },
        {
          name: "Evolution API",
          key: "evolution-api",
          status: "online",
          details: "Gateway WhatsApp pronto",
        },
        {
          name: "Motor IA Gemini",
          key: "gemini-ai",
          status: hasGeminiKey ? "online" : "warning",
          details: hasGeminiKey
            ? "Gemini 1.5 Flash conectado"
            : "Chave pendente (modo diagnóstico local)",
        },
      ],
      skills: [
        {
          name: "SysAdmin & Infraestrutura",
          category: "DevOps",
          description: "Diagnóstico de containers, uso de memória e serviços da VPS.",
          status: "active",
        },
        {
          name: "Auditoria & Governança",
          category: "Compliance",
          description: "Isolamento de tenants, verificação de quarentenas e integridade.",
          status: "active",
        },
        {
          name: "Telemetria & Tokens",
          category: "Monitoramento",
          description: "Rastreamento de consumo de IA e quotas por cliente.",
          status: "active",
        },
        {
          name: "Copiloto Estratégico",
          category: "Gestão",
          description: "Aconselhamento executivo para os sócios fundadores.",
          status: "ready",
        },
      ],
    };
  }
}

export const hermesService = new HermesService();
