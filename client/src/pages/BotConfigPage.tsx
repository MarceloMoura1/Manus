'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Bot,
  Copy,
  Check,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
  Zap,
  Database,
  Ticket,
  UserCheck,
  ShieldCheck,
  ArrowUpRight,
  Info
} from 'lucide-react';

export function BotConfigPage() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [builderUrl, setBuilderUrl] = useState('/typebot-builder/');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Configura a URL do builder baseada na origem atual
    if (typeof window !== 'undefined') {
      setBuilderUrl(`${window.location.origin}/typebot-builder/`);
    }
  }, []);

  const webhookBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/bot`
    : 'https://app.megadesk.online/api/bot';

  const copyToClipboard = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(`${label} copiado para a área de transferência!`);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2500);
  };

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
      iframe.src = iframe.src;
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── TOPO: Painel de Status e Integração ─────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Status do Motor Typebot */}
        <Card className="border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 via-white to-teal-50/30 shadow-sm dark:bg-slate-900/60 dark:border-emerald-900/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider uppercase text-emerald-700 dark:text-emerald-400">
                Motor Conversacional
              </span>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <CardTitle className="text-lg font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Bot className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Typebot Conectado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
            <p>
              Instância isolada em contêiner Docker na porta interna 3002 com banco Postgres dedicado.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Badge variant="outline" className="bg-emerald-100/80 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Multi-Tenant Seguro
              </Badge>
              <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300">
                v2.29.0 / ARM64
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Webhook de Transbordo Humano */}
        <Card className="border-blue-200/80 bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/30 shadow-sm dark:bg-slate-900/60 dark:border-blue-900/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider uppercase text-blue-700 dark:text-blue-400">
                Webhook de Ação
              </span>
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Transbordo Humano
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-slate-600 dark:text-slate-400">
              Cole esta URL no nó Webhook do fluxo para transferir o cliente para o atendente humano:
            </p>
            <div className="flex items-center gap-2 bg-slate-100/90 dark:bg-slate-800/90 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <code className="text-[11px] font-mono truncate text-blue-700 dark:text-blue-300 flex-1">
                {webhookBaseUrl}/typebot-webhook
              </code>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 hover:bg-blue-100 dark:hover:bg-blue-950"
                onClick={() =>
                  copyToClipboard(
                    `${webhookBaseUrl}/typebot-webhook`,
                    'webhook-url',
                    'URL de Webhook'
                  )
                }
              >
                {copiedKey === 'webhook-url' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-600" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Ferramentas de Negócio (API Tools) */}
        <Card className="border-purple-200/80 bg-gradient-to-br from-purple-50/50 via-white to-pink-50/30 shadow-sm dark:bg-slate-900/60 dark:border-purple-900/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider uppercase text-purple-700 dark:text-purple-400">
                Integração HTTP (Tools)
              </span>
              <Info className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Endpoints de Consulta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between group">
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <Database className="w-3.5 h-3.5 text-red-500" />
                Estoque / Produtos:
              </span>
              <button
                type="button"
                className="font-mono text-[11px] text-purple-700 hover:underline dark:text-purple-300 flex items-center gap-1"
                onClick={() =>
                  copyToClipboard(
                    `${webhookBaseUrl}/tools/products`,
                    'tool-products',
                    'Endpoint de Produtos'
                  )
                }
              >
                /tools/products
                {copiedKey === 'tool-products' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 opacity-60" />}
              </button>
            </div>

            <div className="flex items-center justify-between group">
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <Ticket className="w-3.5 h-3.5 text-orange-500" />
                Chamados (Tickets):
              </span>
              <button
                type="button"
                className="font-mono text-[11px] text-purple-700 hover:underline dark:text-purple-300 flex items-center gap-1"
                onClick={() =>
                  copyToClipboard(
                    `${webhookBaseUrl}/tools/tickets`,
                    'tool-tickets',
                    'Endpoint de Chamados'
                  )
                }
              >
                /tools/tickets
                {copiedKey === 'tool-tickets' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 opacity-60" />}
              </button>
            </div>

            <div className="flex items-center justify-between group">
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <UserCheck className="w-3.5 h-3.5 text-blue-500" />
                Captura de Leads:
              </span>
              <button
                type="button"
                className="font-mono text-[11px] text-purple-700 hover:underline dark:text-purple-300 flex items-center gap-1"
                onClick={() =>
                  copyToClipboard(
                    `${webhookBaseUrl}/tools/leads`,
                    'tool-leads',
                    'Endpoint de Leads'
                  )
                }
              >
                /tools/leads
                {copiedKey === 'tool-leads' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 opacity-60" />}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── CORPO: Construtor Visual do Typebot (iframe) ───────────────── */}
      <div
        ref={containerRef}
        className={`relative rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-950 transition-all duration-200 ${
          isFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : 'h-[750px] min-h-[600px]'
        }`}
      >
        {/* Barra de Controles do Editor */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 dark:bg-slate-900/90 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Construtor de Fluxos Typebot
            </span>
          </div>

          <div className="flex items-center gap-1.5">
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
              className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => window.open(builderUrl, '_blank', 'noopener,noreferrer')}
              title="Abrir construtor em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir em Nova Aba
            </Button>
          </div>
        </div>

        {/* Loading Spinner enquanto o iframe carrega */}
        {!iframeLoaded && (
          <div className="absolute inset-0 top-11 z-10 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm dark:bg-slate-900/80">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-white shadow-md border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
              <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Carregando Construtor Typebot...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Conectando ao serviço interno na porta 3002
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Iframe do Construtor */}
        <iframe
          id="typebot-iframe"
          src={builderUrl}
          className="w-full h-[calc(100%-44px)] border-0"
          title="Typebot Builder"
          allow="clipboard-read; clipboard-write; fullscreen"
          onLoad={() => setIframeLoaded(true)}
        />
      </div>
    </div>
  );
}
