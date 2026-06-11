/**
 * WhatsAppBaileysPage
 * Rota /whatsapp — redireciona para Configurações → aba WhatsApp.
 * A integração WhatsApp agora usa a Evolution API via /settings.
 */
import React, { useEffect } from "react";

export function WhatsAppBaileysPage() {
  useEffect(() => {
    // Redirecionar para a página de configurações (onde está a aba WhatsApp)
    window.location.href = "/settings";
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-slate-600 text-sm">Redirecionando para Configurações...</p>
      </div>
    </div>
  );
}
