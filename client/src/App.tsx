import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Home } from "./pages/Home";
import AdminPanel from "./pages/AdminPanel";
import { SettingsPage } from "./pages/SettingsPage";
import { BotConfigPage } from "./pages/BotConfigPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { WhatsAppBaileysPage } from "./pages/WhatsAppBaileysPage";
import DebugLogsPage from "./pages/DebugLogsPage";
import { AIAssistant } from "./components/AIAssistant";
import { trpc } from "./lib/trpc";
import { ThemeProvider } from "./contexts/ThemeContext";

function isAdminRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isSettingsRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function isBotConfigRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/bot-config" || pathname.startsWith("/bot-config/");
}

function isNotificationsRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/notifications" || pathname.startsWith("/notifications/");
}

function isWhatsAppBaileysRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/whatsapp" || pathname.startsWith("/whatsapp/");
}

function isDebugRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/debug" || pathname.startsWith("/debug/");
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers() {
            // Forward local session token for megaadmin procedures if present
            const token = localStorage.getItem("megadesk-session-token");
            const headers: Record<string, string> = {};
            if (token) headers["Authorization"] = `Bearer ${token}`;
            // Forward MegaDesk tenant info for multi-tenant isolation
            try {
              const megadeskSession = localStorage.getItem("megadesk_session_v1");
              if (megadeskSession) {
                const parsed = JSON.parse(megadeskSession);
                if (parsed?.clientId) headers["x-tenant-id"] = parsed.clientId;
                if (parsed?.userRole) headers["x-user-role"] = parsed.userRole;
                else if (parsed?.role) headers["x-user-role"] = parsed.role;
              }
            } catch { /* ignore */ }
            return headers;
          },
        }),
      ],
    }),
  );

  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const platform = isAdminRoute() ? "megaadmin" : isSettingsRoute() || isBotConfigRoute() || isNotificationsRoute() || isWhatsAppBaileysRoute() || isDebugRoute() ? "megadesk" : "megadesk";

  return (
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {isAdminRoute() ? <AdminPanel /> : isDebugRoute() ? <DebugLogsPage /> : isBotConfigRoute() ? <BotConfigPage /> : isNotificationsRoute() ? <NotificationsPage /> : isWhatsAppBaileysRoute() ? <WhatsAppBaileysPage /> : isSettingsRoute() ? <SettingsPage /> : <Home />}

          <AIAssistant
            isOpen={isAssistantOpen}
            onClose={() => setIsAssistantOpen(false)}
            platform={platform}
          />
          {!isAssistantOpen && (
            <button
              onClick={() => setIsAssistantOpen(true)}
              className="fixed bottom-4 right-4 w-14 h-14 bg-blue-500 text-white rounded-full shadow-lg hover:bg-blue-600 transition flex items-center justify-center z-40"
              title="Abrir assistente IA"
            >
              <span className="text-2xl">✨</span>
            </button>
          )}
        </QueryClientProvider>
      </trpc.Provider>
    </ThemeProvider>
  );
}
