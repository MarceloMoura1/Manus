import React from "react";
import { trpc } from "../lib/trpc";
import {
  Cpu,
  RefreshCw,
  Sparkles,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Users,
  Layers,
  Clock,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { cn } from "../lib/utils";

function formatTokens(val: number): string {
  if (val >= 1_000_000) {
    return `${(val / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}M`;
  }
  if (val >= 1_000) {
    return `${(val / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
  }
  return val.toLocaleString("pt-BR");
}

function formatDate(isoStr?: string): string {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoStr;
  }
}

function formatDateTime(isoStr?: string): string {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return isoStr;
  }
}

export interface AITokenUsagePageProps {
  embedded?: boolean;
  isDrawer?: boolean;
}

export function AITokenUsagePage({ embedded = false, isDrawer = false }: AITokenUsagePageProps = {}) {
  const { data, isLoading, isError, error, refetch, isFetching } =
    trpc.aiUsage.getSummary.useQuery(undefined, {
      refetchInterval: 30_000,
      staleTime: 10_000,
    });

  const summary = data?.summary;
  const percentUsed = summary?.percent_used ?? 0;

  // Status visual baseado no percentual
  const statusColor =
    percentUsed >= 90
      ? "text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"
      : percentUsed >= 70
        ? "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
        : "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10";

  const progressBgColor =
    percentUsed >= 90
      ? "bg-rose-500"
      : percentUsed >= 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full text-foreground overflow-hidden",
        isDrawer
          ? "bg-transparent border-0 shadow-none"
          : embedded
            ? "bg-card rounded-2xl border border-border shadow-xs"
            : "bg-background"
      )}
    >
      {/* Header */}
      {isDrawer ? (
        <div className="flex-none px-4 py-3 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-muted text-muted-foreground border-border">
              Ciclo Atual
            </Badge>
            <span className="text-xs text-muted-foreground">Tokens auditados em tempo real</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs h-7 px-2.5 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${isFetching ? "animate-spin text-indigo-500" : ""}`} />
            Atualizar
          </Button>
        </div>
      ) : embedded ? (
        <div className="flex-none px-5 py-3.5 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                Auditoria de Consumo de IA
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-muted text-muted-foreground border-border">
                  Tempo Real
                </Badge>
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Métricas de tokens faturados no ciclo de faturamento atual.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs h-7 px-2.5 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${isFetching ? "animate-spin text-indigo-500" : ""}`} />
            Atualizar
          </Button>
        </div>
      ) : (
        <header className="flex-none px-6 py-4 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                  Gestão e Auditoria de Consumo de IA
                  <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border">
                    White-Label
                  </Badge>
                </h1>
                <p className="text-xs text-muted-foreground">
                  Auditoria em tempo real de tokens consumidos pela inteligência artificial neste ciclo de faturamento.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-xs h-8 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin text-indigo-500" : ""}`} />
              Atualizar
            </Button>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <div className={cn("flex-1 overflow-y-auto space-y-6", embedded ? "p-4 sm:p-5" : "p-6")}>
        {isError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Erro ao carregar auditoria de tokens</p>
              <p className="text-rose-600/80 dark:text-rose-300/80">
                {error?.message || "Verifique se sua conta possui privilégios de administrador."}
              </p>
            </div>
          </div>
        )}

        {/* 4 KPI Top Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Cota Mensal */}
          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Franquia Mensal</CardTitle>
              <Cpu className="w-4 h-4 text-indigo-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-extrabold tracking-tight text-foreground">
                {isLoading ? "---" : formatTokens(summary?.total_limit ?? 0)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-muted-foreground" /> Cota mensal inclusa no plano
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Total Utilizado */}
          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Consumido</CardTitle>
              <ArrowUpRight className="w-4 h-4 text-sky-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-extrabold tracking-tight text-foreground flex items-baseline gap-2">
                {isLoading ? "---" : formatTokens(summary?.total_used ?? 0)}
                <span className="text-xs font-semibold text-muted-foreground">({percentUsed}%)</span>
              </div>
              <div className="mt-2 w-full bg-muted h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full ${progressBgColor} transition-all duration-500`}
                  style={{ width: `${Math.min(100, percentUsed)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Saldo Disponível */}
          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Saldo Disponível</CardTitle>
              {percentUsed >= 90 ? (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-extrabold tracking-tight text-foreground">
                {isLoading ? "---" : formatTokens(summary?.remaining_tokens ?? 0)}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor}`}>
                  {percentUsed >= 100
                    ? "Limite Atingido"
                    : percentUsed >= 90
                      ? "Atenção Crítica"
                      : percentUsed >= 70
                        ? "Uso Moderado"
                        : "Saudável"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Renovação do Ciclo */}
          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Renovação do Ciclo</CardTitle>
              <Calendar className="w-4 h-4 text-purple-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-extrabold tracking-tight text-foreground">
                {isLoading ? "---" : formatDate(summary?.cycle_renewal_date)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-muted-foreground" />
                {isLoading ? "calculando..." : `${summary?.days_remaining ?? 0} dias para renovação`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 3-Column Detailed Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Consumo por Funcionalidade */}
          <Card className="bg-card border-border shadow-xs flex flex-col">
            <CardHeader className="pb-3 px-5 pt-4 border-b border-border">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-500" />
                Consumo por Funcionalidade
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Divisão do volume de tokens por origem das requisições.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 flex-1 flex flex-col justify-between">
              {isLoading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 bg-muted/60 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (data?.by_source?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  Nenhum consumo registrado neste ciclo.
                </div>
              ) : (
                <div className="space-y-4">
                  {data?.by_source.map((item) => (
                    <div key={item.source} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{item.label}</span>
                        <div className="text-right">
                          <span className="font-semibold text-foreground">{formatTokens(item.tokens)}</span>
                          <span className="text-[11px] text-muted-foreground ml-1.5 font-mono">({item.percentage}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, item.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Total faturado no ciclo</span>
                <span className="font-semibold text-foreground">{formatTokens(summary?.total_used ?? 0)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Column 2: Consumo por Operador */}
          <Card className="bg-card border-border shadow-xs flex flex-col">
            <CardHeader className="pb-3 px-5 pt-4 border-b border-border">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-500" />
                Consumo por Operador
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Detalhamento individual de uso por usuário ou sistema.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <ScrollArea className="h-[280px]">
                {isLoading ? (
                  <div className="p-5 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-10 bg-muted/60 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : (data?.by_operator?.length ?? 0) === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    Nenhum consumo individual computado.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data?.by_operator.map((op) => (
                      <div key={op.userId} className="p-4 flex items-center justify-between hover:bg-muted/40 transition-colors">
                        <div className="min-w-0 pr-3">
                          <p className="text-xs font-semibold text-foreground truncate">{op.name}</p>
                          {op.email && (
                            <p className="text-[11px] text-muted-foreground truncate font-mono">{op.email}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-foreground">{formatTokens(op.tokens)}</p>
                          <span className="text-[10px] text-muted-foreground font-mono">{op.percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Column 3: Log Recente de Auditoria */}
          <Card className="bg-card border-border shadow-xs flex flex-col">
            <CardHeader className="pb-3 px-5 pt-4 border-b border-border">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                Auditoria Recente
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Últimas requisições processadas e tokens faturados.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <ScrollArea className="h-[280px]">
                {isLoading ? (
                  <div className="p-5 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-10 bg-muted/60 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : (data?.recent_activity?.length ?? 0) === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    Nenhum log recente de requisição.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data?.recent_activity.map((log) => (
                      <div key={log.id} className="p-3.5 hover:bg-muted/40 transition-colors text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800">
                            {log.featureLabel}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-foreground">
                          <span className="truncate max-w-[150px] font-medium">{log.operatorName}</span>
                          <span className="font-mono font-semibold text-foreground">
                            {log.totalTokens.toLocaleString("pt-BR")} tokens
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground font-mono">
                          <span>Prompt: {log.promptTokens}</span>
                          <span>•</span>
                          <span>Resposta: {log.completionTokens}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default AITokenUsagePage;
