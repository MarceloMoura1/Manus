import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Home } from "./pages/Home";
import AdminPanel from "./pages/AdminPanel";
import { SettingsPage } from "./pages/SettingsPage";
import { BotConfigPage } from "./pages/BotConfigPage";
import { NotificationsModernPage } from "./pages/NotificationsModernPage";
import { WhatsAppBaileysPage } from "./pages/WhatsAppBaileysPage";
import { trpc } from "./lib/trpc";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import { browserBrandForHostname } from "./lib/browser-branding";
import { trpcBaseUrl } from "./lib/trpc-url";

const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
const browserBrand = browserBrandForHostname(hostname);
const IS_PROD = hostname.endsWith("megadesk.online");
const TRPC_URL = trpcBaseUrl(hostname);
// Canonical backend path remains /api/trpc; trpcBaseUrl only selects its origin.
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

  useEffect(() => {
    document.title = browserBrand.title;
  }, []);

  return (
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            {isAdminRoute() ? <AdminPanel /> : isBotConfigRoute() ? <BotConfigPage /> : isNotificationsRoute() ? <NotificationsModernPage /> : isWhatsAppBaileysRoute() ? <WhatsAppBaileysPage /> : isSettingsRoute() ? <SettingsPage /> : <Home />}
          </ErrorBoundary>
        </QueryClientProvider>
      </trpc.Provider>
    </ThemeProvider>
  );
}
