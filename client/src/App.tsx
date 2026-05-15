import { useState } from "react";
import { Router, Route, Switch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Home } from "./pages/Home";
import AdminPanel from "./pages/AdminPanel";
import { ChamadoDetail } from "./pages/ChamadoDetail";
import { AIAssistant } from "./components/AIAssistant";
import { trpc } from "./lib/trpc";
import { ThemeProvider } from "./contexts/ThemeContext";

function isAdminRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/admin" || pathname.startsWith("/admin/");
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
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );

  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const platform = isAdminRoute() ? "megaadmin" : "megadesk";

  return (
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Router>
            <Switch>
              {/* Admin routes */}
              <Route path="/admin/:rest*" component={AdminPanel} />
              
              {/* MegaDesk routes */}
              <Route path="/chamado/:id" component={ChamadoDetail} />
              <Route path="/" component={Home} />
              
              {/* Fallback to home */}
              <Route component={Home} />
            </Switch>
          </Router>

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
