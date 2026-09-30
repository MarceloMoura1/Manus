export type SafeAssistantFailure = {
  code: "PRECONDITION_FAILED" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR";
  message: string;
  errorClass: string;
};

export function classifyAssistantFailure(error: unknown): SafeAssistantFailure {
  const raw = error instanceof Error ? error.message : "";
  if (raw.startsWith("Token Gemini não configurado")) {
    return {
      code: "PRECONDITION_FAILED",
      message: "Token Gemini não configurado para este cliente.",
      errorClass: "CLIENT_GEMINI_NOT_CONFIGURED",
    };
  }
  if (raw.startsWith("Quota mensal de tokens atingida")) {
    return {
      code: "TOO_MANY_REQUESTS",
      message: "Cota mensal do Assistente IA atingida.",
      errorClass: "CLIENT_GEMINI_QUOTA_EXCEEDED",
    };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível gerar a resposta do Assistente IA.",
    errorClass: error instanceof Error ? error.name : "UNKNOWN_ASSISTANT_FAILURE",
  };
}
