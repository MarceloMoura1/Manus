import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Home } from "./pages/Home";
import AdminPanel from "./pages/AdminPanel";
import { SettingsPage } from "./pages/SettingsPage";
import { BotConfigPage } from "./pages/BotConfigPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { WhatsAppBaileysPage } from "./pages/WhatsAppBaileysPage";
import { AIAssistant } from "./components/AIAssistant";
import { trpc } from "./lib/trpc";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";

// URL da API: produção usa subdomínio dedicado, local usa relativo
const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
const IS_PROD = hostname.endsWith("megadesk.online");
const TRPC_URL = IS_PROD ? "https://api.megadesk.online/api/trpc" : "/api/trpc";
// admin.megadesk.online sempre renderiza AdminPanel
const IS_ADMIN_SUBDOMAIN = hostname === "admin.megadesk.online";

function isAdminRoute() {
  if (IS_ADMIN_SUBDOMAIN) return true;
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

export default function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_URL,
          transformer: superjson,
          fetch(url, options) {
            return fetch(url, { ...options, credentials: "include" });
          },
          headers() {
            // Forward local session token for megaadmin procedures if present
            const token = localStorage.getItem("megadesk-session-token");
            const headers: Record<string, string> = {};
            if (token) headers["Authorization"] = `Bearer ${token}`;
            return headers;
          },
        }),
      ],
    }),
  );

  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  useEffect(() => {
    const openAssistant = () => setIsAssistantOpen(true);
    window.addEventListener("megadesk-open-assistant", openAssistant);
    return () => window.removeEventListener("megadesk-open-assistant", openAssistant);
  }, []);
  const usesAuthenticatedHomeShell = !isAdminRoute() && !isSettingsRoute() && !isBotConfigRoute() && !isNotificationsRoute() && !isWhatsAppBaileysRoute();
  const platform = isAdminRoute() ? "megaadmin" : isSettingsRoute() || isBotConfigRoute() || isNotificationsRoute() || isWhatsAppBaileysRoute() ? "megadesk" : "megadesk";

  return (
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            {isAdminRoute() ? <AdminPanel /> : isBotConfigRoute() ? <BotConfigPage /> : isNotificationsRoute() ? <NotificationsPage /> : isWhatsAppBaileysRoute() ? <WhatsAppBaileysPage /> : isSettingsRoute() ? <SettingsPage /> : <Home />}
          </ErrorBoundary>

          <AIAssistant
            isOpen={isAssistantOpen}
            onClose={() => setIsAssistantOpen(false)}
            platform={platform}
          />
          {!isAssistantOpen && !usesAuthenticatedHomeShell && (
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
