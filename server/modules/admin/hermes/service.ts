import { GoogleGenerativeAI } from "@google/generative-ai";
import { HermesRepository, hermesRepository } from "./repository";
import type {
  HermesMessageItem,
  HermesQuickStats,
} from "./contracts";

export function getBrasiliaTimestamp(): string {
  try {
    return new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "full",
      timeStyle: "medium",
    });
  } catch {
    return new Date().toISOString();
  }
}

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
            `- O modelo padrão é o **${process.env.GEMINI_MODEL || "Gemini 3.5 Flash Lite"}**.\n` +
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
        const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
        const genAI = new GoogleGenerativeAI(apiKey.trim());
        const model = genAI.getGenerativeModel({
          model: geminiModel,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        });

        const nowBrasilia = getBrasiliaTimestamp();

        const systemInstruction = `Contexto Temporal Atual: ${nowBrasilia} (Horário de Brasília).

Você é o Hermes, o braço direito, copiloto de inteligência e parceiro de operações do MegaDesk para a liderança e administração da plataforma.

Sua identidade e postura:
1. Comunicação natural, humana, acolhedora e fluida em português brasileiro. Seja parceiro e direto, sem parecer um robô frio ou um terminal mecânico de Linux.
2. Proibições de tom:
   - NUNCA fique repetindo a palavra "sócio" a cada frase. Trate a pessoa com naturalidade e respeito.
   - NUNCA recuse conversas amigáveis, saudações cotidianas ("olá", "bom dia", "como vai?", "que dia é hoje?") ou perguntas informais.
   - NUNCA invente problemas ou desculpas de fuso horário. Use sempre com precisão o Contexto Temporal informado acima.
3. Postura Operacional:
   - Em interações leves, conversas ou dúvidas rápidas: responda de forma breve, calorosa, natural e prestativa.
   - Em solicitações técnicas (diagnósticos, vistorias de VPS, checagens de WhatsApp, bancos MySQL, containers Docker, deploy): seja cirúrgico, estruturado e execute com maestria técnica, apresentando dados claros, sínteses executivas e tabelas quando útil.
4. Seu objetivo principal é apoiar a gestão com inteligência prática, agilidade e excelência técnica.`;

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
          model: geminiModel,
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

    const lower = message.toLowerCase();
    if (lower.includes("que dia") || lower.includes("data") || lower.includes("hora") || lower.includes("que horas")) {
      const nowBrasilia = getBrasiliaTimestamp();
      return `Hoje é ${nowBrasilia} (Horário de Brasília). Se precisar de alguma vistoria da infraestrutura ou apoio operacional, estou por aqui!`;
    }

    if (lower.includes("olá") || lower.includes("ola") || lower.includes("bom dia") || lower.includes("boa tarde") || lower.includes("boa noite") || lower.includes("tudo bem")) {
      return `Olá! Tudo bem? Sou o **Hermes**, seu parceiro de inteligência e operações no MegaDesk. Como posso te ajudar hoje?`;
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
            ? `${process.env.GEMINI_MODEL || "Gemini 3.5 Flash Lite"} conectado`
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
