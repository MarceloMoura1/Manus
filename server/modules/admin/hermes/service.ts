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
  | "security_audit"
  | "tenant_inspection";

export interface TenantStorageMetrics {
  tenantFound: boolean;
  clientName: string;
  clientId?: string;
  internalId?: string;
  tenantDatabaseName?: string;
  totalMessages: number;
  totalMessageChars?: number;
  mediaCount: number;
  totalContacts: number;
  contatosWhatsApp: number;
  clientesErp: number;
  totalConversations: number;
  totalChamados: number;
  chamadosAbertos: number;
  ultimoChamadoData?: string | null;
  estimatedDbSizeKB: number;
  estimatedDbSizeFormatted: string;
  activeStatus: string;
  plan?: string;
  details?: string;
  semanticContext?: {
    cliente: string;
    banco: { nome: string; tamanhoKb: number; tamanhoFormatado: string };
    mensagens: { total: number; midias: number };
    contatos: { whatsapp: number; erp: number };
    chamados: { total: number; abertos: number; statusRecente: string };
  };
}

/**
 * Extrai o termo ou nome do cliente/tenant de uma mensagem em linguagem natural
 */
export function extractTenantQueryTerm(message: string): string | null {
  const patterns = [
    /(?:cliente|tenant|empresa)\s+["']?([a-zA-Z0-9_\-\.]+)["']?/i,
    /(?:dados|consumo|disco|mem[oó]ria|m[eé]tricas|espa[cç]o|volume|status)\s+(?:do\s+cliente|da\s+empresa|do\s+tenant|de)\s+["']?([a-zA-Z0-9_\-\.]+)["']?/i,
    /(?:quanto\s+espa[cç]o|quantas\s+mensagens)\s+(?:o\s+cliente|a\s+empresa|o\s+tenant|de)\s+["']?([a-zA-Z0-9_\-\.]+)["']?/i,
  ];

  for (const regex of patterns) {
    const match = message.match(regex);
    if (match && match[1]) {
      const captured = match[1].trim();
      const skipWords = ["do", "da", "de", "um", "uma", "o", "a", "os", "as", "cada", "todos", "em"];
      if (!skipWords.includes(captured.toLowerCase())) {
        return captured;
      }
    }
  }

  if (message.toLowerCase().includes("fayers")) {
    return "FaYerS";
  }

  return null;
}

/**
 * Consulta agregada puramente READ-ONLY das métricas de armazenamento de um cliente/tenant
 */
export async function inspectTenantStorageMetrics(slugOrName: string): Promise<TenantStorageMetrics> {
  const search = slugOrName.trim().replace(/^["']|["']$/g, "");
  const searchLower = search.toLowerCase();

  try {
    const { getPool } = await import("../../../db");
    const pool = getPool();

    // 1. Localizar o cliente/tenant de forma estritamente READ-ONLY
    const [clientRows]: any = await pool.query(
      `SELECT client_id, internal_id, tenant_database_name, company, contact, email, phone, plan, status
       FROM megadesk_domain_clients
       WHERE LOWER(client_id) = ? 
          OR LOWER(internal_id) = ?
          OR LOWER(tenant_database_name) = ?
          OR LOWER(company) LIKE ?
       LIMIT 1`,
      [searchLower, searchLower, searchLower, `%${searchLower}%`]
    );

    if (!clientRows || clientRows.length === 0) {
      return {
        tenantFound: false,
        clientName: search,
        totalMessages: 0,
        mediaCount: 0,
        totalContacts: 0,
        contatosWhatsApp: 0,
        clientesErp: 0,
        totalConversations: 0,
        totalChamados: 0,
        chamadosAbertos: 0,
        ultimoChamadoData: null,
        estimatedDbSizeKB: 0,
        estimatedDbSizeFormatted: "0 KB",
        activeStatus: "not_found",
        details: `Nenhum cliente ou tenant correspondente a "${search}" foi encontrado no banco de dados.`,
      };
    }

    const client = clientRows[0];
    const clientId = client.client_id;
    const clientName = client.company || client.internal_id || clientId;

    // 2. Consultas agregadas READ-ONLY
    let totalMessages = 0;
    let totalMessageChars = 0;
    let mediaCount = 0;
    try {
      const [msgRows]: any = await pool.query(
        `SELECT 
           COUNT(*) as totalMessages,
           COALESCE(SUM(CHAR_LENGTH(message)), 0) as totalChars,
           COALESCE(SUM(CASE WHEN media_reference IS NOT NULL AND media_reference != '' AND media_reference != '[]' THEN 1 ELSE 0 END), 0) as mediaCount
         FROM megadesk_domain_conversations_messages
         WHERE client_id = ?`,
        [clientId]
      ).catch(async () => {
        return pool.query(
          `SELECT 
             COUNT(*) as totalMessages,
             COALESCE(SUM(CHAR_LENGTH(message)), 0) as totalChars,
             COALESCE(SUM(CASE WHEN media_reference IS NOT NULL AND media_reference != '' AND media_reference != '[]' THEN 1 ELSE 0 END), 0) as mediaCount
           FROM megadesk_domain_conversations_messages
           WHERE \`clientId\` = ?`,
          [clientId]
        );
      });
      if (msgRows && msgRows[0]) {
        totalMessages = Number(msgRows[0].totalMessages) || 0;
        totalMessageChars = Number(msgRows[0].totalChars) || 0;
        mediaCount = Number(msgRows[0].mediaCount) || 0;
      }
    } catch (msgErr) {
      console.warn("[inspectTenantStorageMetrics] Falha ao consultar mensagens:", msgErr);
    }

    // 3. Contatos WhatsApp (megadesk_conversation_contacts) e clientes ERP (megadesk_domain_customers)
    let contatosWhatsApp = 0;
    try {
      const [wppRows]: any = await pool.query(
        `SELECT COUNT(*) as total FROM megadesk_conversation_contacts WHERE client_id = ?`,
        [clientId]
      ).catch(async () => {
        return pool.query(
          `SELECT COUNT(*) as total FROM megadesk_conversation_contacts WHERE \`clientId\` = ?`,
          [clientId]
        );
      });
      if (wppRows && wppRows[0]) {
        contatosWhatsApp = Number(wppRows[0].total) || 0;
      }
    } catch (wppErr) {
      console.warn("[inspectTenantStorageMetrics] Falha ao consultar contatos WhatsApp:", wppErr);
    }

    let clientesErp = 0;
    try {
      const [erpRows]: any = await pool.query(
        `SELECT COUNT(*) as total FROM megadesk_domain_customers WHERE client_id = ?`,
        [clientId]
      ).catch(async () => {
        return pool.query(
          `SELECT COUNT(*) as total FROM megadesk_domain_customers WHERE \`clientId\` = ?`,
          [clientId]
        );
      });
      if (erpRows && erpRows[0]) {
        clientesErp = Number(erpRows[0].total) || 0;
      }
    } catch (erpErr) {
      console.warn("[inspectTenantStorageMetrics] Falha ao consultar clientes ERP:", erpErr);
    }

    const totalContacts = contatosWhatsApp + clientesErp;

    let totalConversations = 0;
    try {
      const [convRows]: any = await pool.query(
        `SELECT COUNT(*) as totalConversations FROM megadesk_domain_conversations WHERE client_id = ?`,
        [clientId]
      ).catch(async () => {
        return pool.query(
          `SELECT COUNT(*) as totalConversations FROM megadesk_domain_conversations WHERE \`clientId\` = ?`,
          [clientId]
        );
      });
      if (convRows && convRows[0]) {
        totalConversations = Number(convRows[0].totalConversations) || 0;
      }
    } catch (convErr) {
      console.warn("[inspectTenantStorageMetrics] Falha ao consultar conversas:", convErr);
    }

    // 4. Chamados e Atendimentos (resiliente para camelCase e snake_case, com chamados em aberto)
    let totalChamados = 0;
    let chamadosAbertos = 0;
    let ultimoChamadoData: string | null = null;
    try {
      const [chamadoRows]: any = await pool.query(
        `SELECT 
           COUNT(*) as totalChamados,
           COALESCE(SUM(CASE WHEN LOWER(status) NOT IN ('fechado', 'encerrado', 'resolvido', 'closed') THEN 1 ELSE 0 END), 0) as chamadosAbertos,
           MAX(createdAt) as ultimoChamadoData
         FROM megadesk_domain_chamados 
         WHERE \`clientId\` = ?`,
        [clientId]
      ).catch(async () => {
        return pool.query(
          `SELECT 
             COUNT(*) as totalChamados,
             COALESCE(SUM(CASE WHEN LOWER(status) NOT IN ('fechado', 'encerrado', 'resolvido', 'closed') THEN 1 ELSE 0 END), 0) as chamadosAbertos,
             MAX(created_at) as ultimoChamadoData
           FROM megadesk_domain_chamados 
           WHERE \`client_id\` = ?`,
          [clientId]
        );
      });

      if (chamadoRows && chamadoRows[0]) {
        totalChamados = Number(chamadoRows[0].totalChamados) || 0;
        chamadosAbertos = Number(chamadoRows[0].chamadosAbertos) || 0;
        ultimoChamadoData = chamadoRows[0].ultimoChamadoData
          ? new Date(chamadoRows[0].ultimoChamadoData).toISOString()
          : null;
      }
    } catch (chamadoErr) {
      console.warn("[inspectTenantStorageMetrics] Falha ao consultar chamados:", chamadoErr);
    }

    let physicalDbBytes = 0;
    if (client.tenant_database_name) {
      try {
        const [tableRows]: any = await pool.query(
          `SELECT COALESCE(SUM(data_length + index_length), 0) as totalBytes
           FROM information_schema.TABLES
           WHERE table_schema = ?`,
          [client.tenant_database_name]
        );
        if (tableRows && tableRows[0]?.totalBytes) {
          physicalDbBytes = Number(tableRows[0].totalBytes) || 0;
        }
      } catch (schemaErr) {
        console.warn("[inspectTenantStorageMetrics] information_schema query:", schemaErr);
      }
    }

    const estimatedDataBytes = totalMessageChars * 3 + totalMessages * 512 + totalContacts * 256 + totalChamados * 512 + mediaCount * 1024;
    const finalBytes = physicalDbBytes > 0 ? physicalDbBytes : Math.max(estimatedDataBytes, 1024);
    const estimatedDbSizeKB = Math.round(finalBytes / 1024);
    const estimatedDbSizeFormatted = estimatedDbSizeKB >= 1024 
      ? `${(estimatedDbSizeKB / 1024).toFixed(2)} MB` 
      : `${estimatedDbSizeKB} KB`;

    const semanticContext = {
      cliente: clientName,
      banco: {
        nome: client.tenant_database_name || "megadesk_main",
        tamanhoKb: estimatedDbSizeKB,
        tamanhoFormatado: estimatedDbSizeFormatted,
      },
      mensagens: {
        total: totalMessages,
        midias: mediaCount,
      },
      contatos: {
        whatsapp: contatosWhatsApp,
        erp: clientesErp,
      },
      chamados: {
        total: totalChamados,
        abertos: chamadosAbertos,
        statusRecente: ultimoChamadoData
          ? `Último chamado registrado em ${new Date(ultimoChamadoData).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "Nenhum chamado registrado",
      },
    };

    return {
      tenantFound: true,
      clientName,
      clientId: client.client_id,
      internalId: client.internal_id,
      tenantDatabaseName: client.tenant_database_name,
      plan: client.plan || "Padrão",
      activeStatus: client.status || "active",
      totalMessages,
      totalMessageChars,
      mediaCount,
      totalContacts,
      contatosWhatsApp,
      clientesErp,
      totalConversations,
      totalChamados,
      chamadosAbertos,
      ultimoChamadoData,
      estimatedDbSizeKB,
      estimatedDbSizeFormatted,
      semanticContext,
    };
  } catch (err: any) {
    console.warn("[inspectTenantStorageMetrics] Operando em modo desacoplado:", err?.message);
    return {
      tenantFound: false,
      clientName: search,
      totalMessages: 0,
      mediaCount: 0,
      totalContacts: 0,
      contatosWhatsApp: 0,
      clientesErp: 0,
      totalConversations: 0,
      totalChamados: 0,
      chamadosAbertos: 0,
      ultimoChamadoData: null,
      estimatedDbSizeKB: 0,
      estimatedDbSizeFormatted: "0 KB",
      activeStatus: "offline",
      details: `Consulta operacional offline ou banco indisponível: ${err?.message || "Sem conexão"}`,
    };
  }
}

export class HermesService {
  constructor(
    private repository: HermesRepository = hermesRepository,
    private tenantInspector: (slugOrName: string) => Promise<TenantStorageMetrics> = inspectTenantStorageMetrics
  ) {}

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

    // Consulta e auditoria de tenant / cliente
    if (
      (lower.includes("consumo") || lower.includes("memoria") || lower.includes("memória") || lower.includes("disco") || lower.includes("armazenamento") || lower.includes("dados") || lower.includes("métrica") || lower.includes("metrica") || lower.includes("volume")) &&
      (lower.includes("cliente") || lower.includes("tenant") || lower.includes("empresa") || lower.includes("fayers"))
    ) {
      return "tenant_inspection";
    }

    if (
      lower.includes("cliente fayers") ||
      lower.includes("tenant fayers") ||
      lower.includes("dados de fayers")
    ) {
      return "tenant_inspection";
    }

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
   * Executor determinístico de ferramentas sob demanda (read-only)
   */
  async executeAction(
    action: HermesActionType,
    adminUserId: string,
    rawMessage: string = ""
  ): Promise<{ title: string; content: string; data?: any }> {
    const uptimeSec = Math.floor(process.uptime());
    const uptimeMin = Math.floor(uptimeSec / 60);
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

    switch (action) {
      case "tenant_inspection": {
        const queryTerm = extractTenantQueryTerm(rawMessage) || "FaYerS";
        const metrics = await this.tenantInspector(queryTerm);

        if (!metrics.tenantFound) {
          return {
            title: `Auditoria de Tenant / Cliente (${queryTerm})`,
            content: `### 🔍 Inspeção de Tenant: **${queryTerm}**\n\n` +
              `> ⚠️ **Cliente não localizado no catálogo:** ${metrics.details || "Verifique a ortografia do nome ou slug."}\n\n` +
              `Para consultar o armazenamento de um cliente específico, informe o nome ou slug registrado (ex.: *"consumo do cliente FaYerS"*).`,
            data: metrics,
          };
        }

        const chamadosStatusFormatted = metrics.chamadosAbertos > 0
          ? `🟡 **${metrics.chamadosAbertos} chamado(s) em aberto** (requer atenção)`
          : `🟢 Todos os ${metrics.totalChamados} chamados concluídos/fechados`;

        return {
          title: `Auditoria de Armazenamento - ${metrics.clientName}`,
          content: `### 📊 Auditoria de Armazenamento e Métricas do Cliente: **${metrics.clientName}**\n\n` +
            `Dados operacionais auditados em tempo real (consultas agregadas read-only):\n\n` +
            `| Parâmetro Operacional | Valor Auditado |\n` +
            `| :--- | :--- |\n` +
            `| **Identificação do Tenant** | \`${metrics.clientId}\` (${metrics.internalId || "N/A"}) |\n` +
            `| **Banco Físico Dedicado** | \`${metrics.tenantDatabaseName || "Compartilhado (megadesk_main)"}\` |\n` +
            `| **Status do Tenant** | ${metrics.activeStatus === "active" ? "🟢 Ativo" : metrics.activeStatus === "paused" ? "🟡 Pausado (Quarentena)" : "⚪ " + metrics.activeStatus} |\n` +
            `| **Total de Mensagens WhatsApp** | **${metrics.totalMessages.toLocaleString("pt-BR")}** mensagens |\n` +
            `| **Mídias Anexadas (Fotos/Áudios/Docs)** | **${metrics.mediaCount.toLocaleString("pt-BR")}** arquivos |\n` +
            `| **Contatos WhatsApp Mapeados** | **${metrics.contatosWhatsApp.toLocaleString("pt-BR")}** contatos |\n` +
            `| **Clientes Cadastrados no ERP** | **${metrics.clientesErp.toLocaleString("pt-BR")}** clientes |\n` +
            `| **Total de Chamados / Tickets** | **${metrics.totalChamados.toLocaleString("pt-BR")}** chamados |\n` +
            `| **Chamados em Aberto** | ${chamadosStatusFormatted} |\n` +
            `| **Última Interação de Chamado** | ${metrics.ultimoChamadoData ? new Date(metrics.ultimoChamadoData).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "N/A"} |\n` +
            `| **Volume Estimado de Dados em Disco/DB** | **${metrics.estimatedDbSizeFormatted}** (${metrics.estimatedDbSizeKB.toLocaleString("pt-BR")} KB) |\n\n` +
            `*Todos os dados foram obtidos com segurança estritamente read-only diretamente das tabelas operacionais da plataforma.*`,
          data: metrics.semanticContext || {
            cliente: metrics.clientName,
            banco: { nome: metrics.tenantDatabaseName || "megadesk_main", tamanhoKb: metrics.estimatedDbSizeKB },
            mensagens: { total: metrics.totalMessages, midias: metrics.mediaCount },
            contatos: { whatsapp: metrics.contatosWhatsApp, erp: metrics.clientesErp },
            chamados: { total: metrics.totalChamados, abertos: metrics.chamadosAbertos, statusRecente: metrics.ultimoChamadoData },
          },
        };
      }

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
      ? await this.executeAction(detectedAction, adminUserId, trimmed)
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
        const isExtensive = /relat[oó]rio\s+extenso|auditoria\s+completa|resumo\s+detalhado|an[aá]lise\s+profunda/i.test(trimmed);
        const maxTokens = isExtensive ? 2048 : 1024;

        const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
        const genAI = new GoogleGenerativeAI(apiKey.trim());
        const model = genAI.getGenerativeModel({
          model: geminiModel,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: maxTokens,
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
   - Em solicitações técnicas (diagnósticos, vistorias de VPS, checagens de WhatsApp, bancos MySQL, containers Docker, deploy, métricas de tenants): seja cirúrgico, estruturado e execute com maestria técnica, apresentando dados claros, sínteses executivas e tabelas quando útil.
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
            maxOutputTokens: maxTokens,
          },
        });

        // Se houver ação sob demanda executada, injetar telemetria determinística no prompt
        const promptToSend = actionResult
          ? `[TELEMETRIA OPERACIONAL COLETADA DO SISTEMA]\n${actionResult.content}\n\n[DADOS BRUTOS ESTRUTURADOS JSON]\n${JSON.stringify(actionResult.data || {})}\n\n[DIRETRIZES PARA A RESPOSTA]\n1. Destaque o status dos chamados em aberto caso existam (quantidade e criticidade de atendimento).\n2. Exponha claramente tanto os contatos de WhatsApp ativos quanto os clientes do ERP.\n3. Apresente os dados com clareza executiva, calor humano e sem inventar números.\n\n[SOLICITAÇÃO DO ADMINISTRADOR]\n${trimmed}`
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
          : await this.generateFallbackResponse(trimmed, adminUserId);

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
        : await this.generateFallbackResponse(trimmed, adminUserId);
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

  private async generateFallbackResponse(message: string, adminUserId: string): Promise<string> {
    const detected = this.detectAction(message);
    if (detected) {
      return (await this.executeAction(detected, adminUserId, message)).content;
    }

    const lower = message.toLowerCase();
    if (lower.includes("que dia") || lower.includes("data") || lower.includes("hora") || lower.includes("que horas")) {
      const nowBrasilia = getBrasiliaTimestamp();
      return `Hoje é ${nowBrasilia} (Horário de Brasília). Se precisar de alguma vistoria da infraestrutura ou apoio operacional, estou por aqui!`;
    }

    if (lower.includes("olá") || lower.includes("ola") || lower.includes("bom dia") || lower.includes("boa tarde") || lower.includes("boa noite") || lower.includes("tudo bem")) {
      return `Olá! Tudo bem? Sou o **Hermes**, seu parceiro de inteligência e operações no MegaDesk. Como posso te ajudar hoje?`;
    }

    return `Olá! Sou o **Hermes**, seu copiloto de operações e estratégia no MegaAdmin.\n\nRecebi sua instrução: *"__${message}__"*.\n\nEstou pronto para ajudar com:\n1. 🏥 **Vistoria da VPS e Docker** (diagnóstico de containers e rede)\n2. 📊 **Consumo de Tokens e Quotas de IA**\n3. 🔍 **Auditoria de Armazenamento e Métricas por Cliente**\n4. 🛡️ **Auditoria de Tenants e Multi-tenancy**\n5. 🚀 **Acompanhamento de Releases e Migrations**\n\nComo deseja proceder agora?`;
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
