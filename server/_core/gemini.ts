import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

export interface GeminiMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateAIResponse(
  messages: GeminiMessage[],
  systemPrompt?: string
): Promise<string> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

  // Construir histórico de conversa
  const history = messages.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  // Se houver systemPrompt, adicionar como primeira mensagem do sistema
  const systemInstruction = systemPrompt
    ? `${systemPrompt}\n\nResponda sempre em português brasileiro de forma clara e concisa.`
    : "Você é um assistente IA útil. Responda sempre em português brasileiro de forma clara e concisa.";

  const chat = model.startChat({
    history: history.slice(0, -1), // Histórico sem a última mensagem
    systemInstruction,
  });

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    throw new Error("No messages provided");
  }

  const result = await chat.sendMessage(lastMessage.content);
  const response = result.response;
  return response.text();
}

export async function detectPlatformFromContext(url: string): Promise<"megaadmin" | "megadesk"> {
  // Detectar plataforma baseado na URL
  if (url.includes("/admin") || url.includes("admin.") || url.includes("megaadmin")) {
    return "megaadmin";
  }
  return "megadesk";
}

export function getSystemPromptForPlatform(platform: "megaadmin" | "megadesk"): string {
  if (platform === "megaadmin") {
    return `Você é um assistente IA especializado em suporte administrativo da plataforma MegaAdmin.
Você ajuda administradores com:
- Gestão de clientes e suas configurações
- Gerenciamento de administradores
- Liberação de módulos e acesso
- Análise de logs de auditoria
- Configuração de integrações

Sempre forneça respostas técnicas e precisas, focando em boas práticas de administração.`;
  } else {
    return `Você é um assistente IA especializado em suporte operacional da plataforma MegaDesk.
Você ajuda agentes e gerentes com:
- Atendimento ao cliente via WhatsApp
- Gestão de conversas e histórico de mensagens
- Criação e acompanhamento de chamados/tickets
- Rastreamento de encomendas
- Configuração do bot Gemini
- Dúvidas sobre o ERP

Sempre forneça respostas úteis e orientadas ao cliente, focando em resolver problemas rapidamente.`;
  }
}
