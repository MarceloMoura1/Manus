import { AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Enviar ao servidor para diagnóstico
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack?.slice(0, 800),
        page: window.location.pathname,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="flex flex-col items-center w-full max-w-lg p-6 bg-white rounded-2xl border border-red-100 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Erro ao carregar esta seção
            </h2>
            <p className="text-sm text-slate-500 text-center mb-4">
              Ocorreu um erro inesperado. Clique em "Recarregar" para tentar novamente.
            </p>
            {process.env.NODE_ENV === "development" && (
              <details className="w-full mb-4">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                  Detalhes técnicos
                </summary>
                <pre className="mt-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 whitespace-pre-wrap break-words max-h-32 overflow-auto">
                  {this.state.error?.message}
                </pre>
              </details>
            )}
            <div className="flex gap-2 w-full">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition"
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
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
