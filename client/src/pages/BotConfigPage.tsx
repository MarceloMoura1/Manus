'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/trpc';
import {
  Bot,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
  FolderLock,
} from 'lucide-react';

export function BotConfigPage() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // URL base pública padrão
  const defaultBaseUrl =
    (import.meta.env.VITE_TYPEBOT_BUILDER_URL as string | undefined)?.replace(/\/+$/, '') ||
    'https://bot.megadesk.online';

  // ─── Query de resolução do Workspace Multi-Tenant exclusivo ───────────────
  const {
    data: workspaceData,
    isLoading: isLoadingWorkspace,
    isError: isWorkspaceError,
    error: workspaceError,
  } = trpc.bot.getClientWorkspaceUrl.useQuery(undefined, {
    staleTime: 1000 * 60 * 10, // 10 minutos
    retry: 2,
  });

  const activeWorkspaceUrl = workspaceData?.url || defaultBaseUrl;

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {
          setIsFullscreen(true);
        });
      } else {
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const reloadIframe = () => {
    setIframeLoaded(false);
    const iframe = document.getElementById('typebot-iframe') as HTMLIFrameElement | null;
    if (iframe) {
      iframe.src = activeWorkspaceUrl;
    }
  };

  return (
    <div className="w-full">
      {/* ─── CORPO: Construtor Visual do Typebot (iframe expandido) ───────── */}
      {isLoadingWorkspace ? (
        <Card className="border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden">
          <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] min-h-[780px] space-y-4 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-4 border-emerald-200 dark:border-emerald-900 border-t-emerald-600 animate-spin" />
              <Bot className="w-6 h-6 text-emerald-600 absolute inset-0 m-auto" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Sincronizando Workspace do Cliente...
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                Conectando ao banco do Typebot, garantindo isolamento multi-tenant e gerando sessão de auto-login.
              </p>
            </div>
          </div>
        </Card>
      ) : isWorkspaceError ? (
        <Card className="border-red-200 bg-red-50/40 p-8 text-center space-y-3 dark:border-red-900/60 dark:bg-red-950/20 rounded-2xl">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            Não foi possível carregar o workspace dedicado do bot.
          </p>
          <p className="text-xs text-red-600/80 dark:text-red-400/80">
            {workspaceError?.message || 'Verifique as permissões administrativas ou a conexão com o banco do Typebot.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reloadIframe()}
            className="text-xs"
          >
            Tentar Novamente
          </Button>
        </Card>
      ) : (
        <div
          ref={containerRef}
          className={`relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-950 transition-all duration-200 flex flex-col ${
            isFullscreen
              ? 'fixed inset-0 z-50 rounded-none border-0 h-screen w-screen'
              : 'h-[calc(100vh-140px)] min-h-[780px] w-full'
          }`}
        >
          {/* Barra de Controles do Editor */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 dark:bg-slate-900/90 dark:border-slate-800 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/60">
                <Bot className="w-4 h-4" />
              </div>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Construtor de Fluxos Typebot
              </span>
              {workspaceData?.workspaceName && (
                <Badge
                  variant="outline"
                  className="bg-emerald-50/70 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 font-normal text-xs gap-1 py-0.5"
                >
                  <FolderLock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  Workspace: {workspaceData.workspaceName}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
                onClick={reloadIframe}
                title="Recarregar construtor"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recarregar
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Sair da tela cheia' : 'Expandir em tela cheia'}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    Restaurar
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    Tela Cheia
                  </>
                )}
              </Button>

              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                onClick={() => window.open(activeWorkspaceUrl, '_blank', 'noopener,noreferrer')}
                title="Abrir construtor em nova aba"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir em Nova Aba
              </Button>
            </div>
          </div>

          {/* Loading Spinner enquanto o iframe carrega */}
          {!iframeLoaded && (
            <div className="absolute inset-0 top-12 z-10 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm dark:bg-slate-900/80">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-white shadow-md border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Carregando Construtor Typebot...
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Conectando a {activeWorkspaceUrl.replace(/^https?:\/\//, '')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Iframe do Construtor */}
          <iframe
            id="typebot-iframe"
            src={activeWorkspaceUrl}
            className="w-full flex-1 border-0"
            title="Typebot Builder"
            allow="clipboard-read; clipboard-write; fullscreen"
            onLoad={() => setIframeLoaded(true)}
          />
        </div>
      )}
    </div>
  );
}
