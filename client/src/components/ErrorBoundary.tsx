import { AlertTriangle, RotateCcw, ArrowLeft, RefreshCw } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo?: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary caught crash]", error, errorInfo);
    this.setState({ errorInfo });
    // Enviar ao servidor para diagnóstico
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack?.slice(0, 800),
        componentStack: errorInfo?.componentStack?.slice(0, 800),
        page: window.location.pathname,
      }),
    }).catch(() => {});
  }

  handleClearCacheAndReload = () => {
    try {
      localStorage.removeItem("megadesk_session_v1");
      sessionStorage.removeItem("megadesk_session_v1");
      localStorage.removeItem("megadesk_active_page_v1");
    } catch {
      // ignore
    }
    window.location.replace("/");
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="flex flex-col items-center w-full max-w-lg p-6 bg-white rounded-2xl border border-red-100 shadow-sm dark:bg-slate-900 dark:border-red-900/30">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-4 dark:bg-red-950/40">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
              Erro ao carregar esta seção
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
              Ocorreu um erro inesperado. Clique em "Recarregar" para tentar novamente ou limpe o cache da sessão.
            </p>
            <details className="w-full mb-4 group">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">
                Detalhes técnicos
              </summary>
              <pre className="mt-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-auto">
                {this.state.error?.name ? `${this.state.error.name}: ` : ""}{this.state.error?.message}
                {this.state.error?.stack && `\n\nStack:\n${this.state.error.stack}`}
                {this.state.errorInfo?.componentStack && `\n\nComponent Stack:\n${this.state.errorInfo.componentStack}`}
              </pre>
            </details>
            <div className="flex flex-col sm:flex-row gap-2 w-full mb-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
              >
                <RotateCcw className="w-4 h-4" />
                Recarregar
              </button>
            </div>
            <button
              onClick={this.handleClearCacheAndReload}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              Limpar cache da sessão e recarregar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
