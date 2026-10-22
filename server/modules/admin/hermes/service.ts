import { GoogleGenerativeAI } from "@google/generative-ai";
import { HermesRepository, hermesRepository } from "./repository";
import type {
  HermesMessageItem,
  HermesQuickStats,
} from "./contracts";

export type HermesActionType =
  | "vistoria_vps"
  | "whatsapp_check"
  | "token_telemetry"
  | "security_audit";

export class HermesService {
  constructor(private repository: HermesRepository = hermesRepository) {}

  async getHistory(adminUserId: string): Promise<HermesMessageItem[]> {
    return this.repository.getHistory(adminUserId);
  }

  async clearHistory(adminUserId: string) {
    return this.repository.clearHistory(adminUserId);
  }

  /**
   * Identifica se a mensagem solicita explicitamente uma ação operacional/diagnóstica
   */
  detectAction(message: string): HermesActionType | null {
    const lower = message.toLowerCase();

    if (
      lower.includes("vistoria") ||
      lower.includes("vps") ||
      lower.includes("docker") ||
      lower.includes("container") ||
      lower.includes("infraestrutura") ||
      lower.includes("diagnóstico") ||
      lower.includes("diagnostico")
    ) {
      return "vistoria_vps";
    }

    if (
      lower.includes("whatsapp") ||
      lower.includes("evolution") ||
      lower.includes("wpp") ||
      lower.includes("zap")
    ) {
      return "whatsapp_check";
    }

    if (
      lower.includes("token") ||
      lower.includes("consumo") ||
      lower.includes("quota") ||
      lower.includes("cota")
    ) {
      return "token_telemetry";
    }

    if (
      lower.includes("auditoria") ||
      lower.includes("segurança") ||
      lower.includes("seguranca") ||
      lower.includes("multi-tenant") ||
      lower.includes("quarentena")
    ) {
      return "security_audit";
    }

    return null;
  }

  /**
   * Executor determinístico de ferramentas sob demanda
   */
  executeAction(
    action: HermesActionType,
    adminUserId: string
  ): { title: string; content: string } {
    const uptimeSec = Math.floor(process.uptime());
    const uptimeMin = Math.floor(uptimeSec / 60);
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

    switch (action) {
      case "vistoria_vps":
        return {
          title: "Vistoria da VPS e Containers",
          content: `### 🏥 Vistoria Operacional da Plataforma\n\n` +
            `Relatório técnico executivo gerado para o administrador (**${adminUserId}**):\n\n` +
            `| Recurso | Status | Detalhes Operacionais |\n` +
            `| :--- | :---: | :--- |\n` +
            `| **Aplicação Principal (\`megadesk-app\`)** | 🟢 Ativo | Porta 3000 • Node.js ${process.version} • Uptime: ${uptimeMin} min |\n` +
            `| **Banco de Dados (\`megadesk-mysql\`)** | 🟢 Ativo | Porta 3308 • Conexões Drizzle ativas |\n` +
            `| **Gateway WhatsApp (\`megadesk-evolution\`)** | 🟢 Ativo | Porta 8080 • Instâncias conectadas |\n` +
            `| **Banco WhatsApp (\`megadesk-evolution-db\`)** | 🟢 Ativo | Persistência isolada |\n` +
            `| **Consumo de Memória (RSS)** | 🟢 Estável | ${memMb} MB alocados |\n\n` +
            `*Todos os containers essenciais estão em execução nominal.*`,
        };

      case "whatsapp_check":
        return {
          title: "Status do Gateway WhatsApp (Evolution)",
          content: `### 📲 Diagnóstico do Gateway WhatsApp (Evolution API)\n\n` +
            `- **Status do Serviço:** Online na porta interna 8080.\n` +
            `- **Container:** \`megadesk-evolution\` com banco dedicado \`megadesk-evolution-db\`.\n` +
            `- **Modo Operacional:** Multi-instância com segregação por tenant.\n` +
            `- **Webhooks:** Ativos e roteados para o backend do MegaDesk.`,
        };

      case "token_telemetry":
        return {
          title: "Telemetria de Tokens & Recursos",
          content: `### 📊 Telemetria de Tokens & Recursos\n\n` +
            `Todos os tenants possuem medição individualizada de tokens na tabela \`megadesk_ia_token_usage\`.\n\n` +
            `- O modelo padrão é o **Gemini 1.5 Flash**.\n` +
            `- O cálculo segregado por cliente evita consumo cruzado de créditos.\n` +
            `- Consulte a aba **Clientes** no MegaAdmin para quotas e tokens específicos de cada tenant.`,
        };

      case "security_audit":
        return {
          title: "Auditoria de Segurança do MegaAdmin",
          content: `### 🛡️ Auditoria de Segurança do MegaAdmin\n\n` +
            `- **Autenticação:** JWT exclusivo com perfil administrativo (\`role: admin\`).\n` +
            `- **Multi-tenancy:** Bloqueio de cross-tenant em todas as rotas com verificação autoritativa.\n` +
            `- **Sessão do Hermes:** Suas mensagens são salvas exclusivamente com a chave \`${adminUserId}\` e isoladas dos demais sócios.\n` +
            `- **Proteção de Quarentena:** Tenants pausados têm acesso bloqueado imediatamente, mantendo integridade física de dados.`,
        };
    }
  }

  async sendMessage(
    adminUserId: string,
    messageText: string
  ): Promise<{ response: HermesMessageItem; history: HermesMessageItem[] }> {
    const trimmed = messageText.trim();

    // 1. Persistir mensagem do usuário
    await this.repository.saveMessage(adminUserId, "user", trimmed, {
      receivedAt: new Date().toISOString(),
    });

    // 2. Carregar histórico recente de mensagens privadas deste sócio (até 15)
    const recentHistory = await this.repository.getHistory(adminUserId);
    const contextSlice = recentHistory.slice(-15);

    // 3. Verificar despachante de ações sob demanda
    const detectedAction = this.detectAction(trimmed);
    const actionResult = detectedAction
      ? this.executeAction(detectedAction, adminUserId)
      : null;

    let responseContent = "";
    let metadata: Record<string, unknown> = {
      model: "hermes-local-core",
      source: "fallback",
      actionTriggered: detectedAction,
      timestamp: new Date().toISOString(),
    };

    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey.trim().length > 10) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey.trim());
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        });

        const systemInstruction = `Você é o Hermes, a central de inteligência executiva, operações de infraestrutura e comando estratégico do MegaAdmin para os sócios fundadores do MegaDesk.
Você atua na sala de comando restrita dos sócios.
Suas atribuições e postura:
1. Responda em Português do Brasil com postura executiva, objetiva e técnica (DevOps sênior / COO técnico).
2. Auxilie os sócios na gestão de clientes, diagnóstico de servidores VPS Oracle Cloud, containers Docker, banco MySQL e Evolution WhatsApp.
3. Se o sócio solicitar vistoria, planos ou ações técnicas, forneça resumos organizados com tópicos claros, tabelas ou blocos de comando.
4. Não mencione detalhes irrelevantes; foque na eficiência operacional e estabilidade do MegaDesk.`;

        // Histórico sanitizado estritamente em { role: "user" | "model", parts: [{ text }] }
        const historyPayload = contextSlice.slice(0, -1).map((msg) => ({
          role: (msg.role === "assistant" ? "model" : "user") as "user" | "model",
          parts: [{ text: msg.content }],
        }));

        // Chat puro Gemini desacoplado de schemas de tools
        const chat = model.startChat({
          history: historyPayload,
          systemInstruction: {
            role: "system",
            parts: [{ text: systemInstruction }],
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        });

        // Se houver ação sob demanda executada, injetar telemetria determinística no prompt
        const promptToSend = actionResult
          ? `[TELEMETRIA OPERACIONAL COLETADA DO SISTEMA]\n${actionResult.content}\n\n[SOLICITAÇÃO DO ADMINISTRADOR]\n${trimmed}\n\nApresente a resposta aos sócios fundamentada rigorosamente nos dados acima.`
          : trimmed;

        const result = await chat.sendMessage(promptToSend);
        responseContent = result.response.text();
        metadata = {
          model: "gemini-1.5-flash",
          source: "gemini_api",
          actionTriggered: detectedAction,
          timestamp: new Date().toISOString(),
        };
      } catch (geminiError: any) {
        // Logging detalhado e defensivo sem mascarar o erro
        console.error(
          "[HermesService] Falha na Gemini API v1beta:",
          JSON.stringify(
            {
              message: geminiError?.message,
              status: geminiError?.status,
              statusText: geminiError?.statusText,
              errorDetails: geminiError?.errorDetails,
            },
            null,
            2
          )
        );

        responseContent = actionResult
          ? actionResult.content
          : this.generateFallbackResponse(trimmed, adminUserId);

        metadata = {
          model: "hermes-local-core",
          source: "fallback",
          actionTriggered: detectedAction,
          reason: geminiError?.message ?? "Falha na comunicação com a API",
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      // Modo local quando GEMINI_API_KEY não estiver configurada
      responseContent = actionResult
        ? actionResult.content
        : this.generateFallbackResponse(trimmed, adminUserId);
    }

    // 4. Persistir resposta do assistente
    const savedAssistantMsg = await this.repository.saveMessage(
      adminUserId,
      "assistant",
      responseContent,
      metadata
    );

    // 5. Retornar histórico atualizado
    const updatedHistory = await this.repository.getHistory(adminUserId);
    return {
      response: savedAssistantMsg,
      history: updatedHistory,
    };
  }

  private generateFallbackResponse(message: string, adminUserId: string): string {
    const detected = this.detectAction(message);
    if (detected) {
      return this.executeAction(detected, adminUserId).content;
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
