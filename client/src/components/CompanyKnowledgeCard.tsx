import React, { useEffect, useRef, useState } from "react";
import { BookOpen, FileText, RotateCcw, Save, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function CompanyKnowledgeCard({
  compact = false,
  onUpdated,
}: {
  compact?: boolean;
  onUpdated?: () => void;
}) {
  const utils = trpc.useUtils();
  const knowledgeQuery = trpc.assistant.getCompanyKnowledge.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const [playbookDraft, setPlaybookDraft] = useState("");
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (knowledgeQuery.data && !dirty) {
      setPlaybookDraft(knowledgeQuery.data.memory.companyPlaybook || "");
      setSourceFilename(knowledgeQuery.data.memory.sourceFilename || null);
    }
  }, [knowledgeQuery.data, dirty]);

  const saveMutation = trpc.assistant.saveCompanyPlaybook.useMutation({
    onSuccess: async () => {
      setDirty(false);
      toast.success("Base de conhecimento da empresa salva! Assistente IA e Bot do WhatsApp atualizados.");
      await utils.assistant.getCompanyKnowledge.invalidate();
      onUpdated?.();
    },
    onError: (err) => {
      toast.error(err.message || "Não foi possível salvar a base de conhecimento.");
    },
  });

  const resetMutation = trpc.assistant.resetCompanyKnowledge.useMutation({
    onSuccess: async () => {
      setPlaybookDraft("");
      setSourceFilename(null);
      setDirty(false);
      toast.success("Memória da IA zerada. A empresa voltou ao estado neutro inicial.");
      await utils.assistant.getCompanyKnowledge.invalidate();
      onUpdated?.();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao resetar memória da IA.");
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md")) {
      toast.error("Envie um arquivo de texto (.txt ou .md).");
      return;
    }

    try {
      const content = (await file.text()).trim();
      if (!content) {
        toast.error("O arquivo enviado está vazio.");
        return;
      }
      setPlaybookDraft(content);
      setSourceFilename(file.name);
      setDirty(false);
      await saveMutation.mutateAsync({
        companyPlaybook: content,
        sourceFilename: file.name,
      });
    } catch {
      toast.error("Não foi possível ler o arquivo selecionado.");
    }
  };

  const memory = knowledgeQuery.data?.memory;
  const learnedUpdates = memory?.learnedUpdates ?? [];
  const companyName = knowledgeQuery.data?.companyName || "sua empresa";

  return (
    <div
      data-testid="company-knowledge-card"
      className={`rounded-2xl border border-slate-800 bg-slate-900/60 ${compact ? "p-4 space-y-4" : "p-6 space-y-5"} text-slate-100`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <h4 className="text-base font-bold text-slate-100">Base de Conhecimento da Empresa</h4>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Envie um arquivo <code className="px-1 py-0.5 rounded bg-slate-800 text-slate-200">.txt</code> ou{" "}
            <code className="px-1 py-0.5 rounded bg-slate-800 text-slate-200">.md</code> (bloco de notas) ou edite o texto abaixo explicando o que a{" "}
            <strong className="text-slate-200">{companyName}</strong> faz, rotina operacional, horários, políticas e funções da equipe.
            Tanto o <strong className="text-slate-200">Assistente IA</strong> quanto o <strong className="text-slate-200">Bot do WhatsApp</strong> usam esta base em tempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => void handleFileUpload(e)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saveMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:text-white text-xs"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Importar .txt / .md
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={resetMutation.isPending || (!playbookDraft.trim() && learnedUpdates.length === 0)}
            onClick={() => {
              if (window.confirm("Zerar o roteiro e todas as regras aprendidas pela IA para esta empresa?")) {
                resetMutation.mutate();
              }
            }}
            className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:text-white text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Resetar Memória da IA
          </Button>
        </div>
      </div>

      {sourceFilename && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            Arquivo base importado: <strong className="text-slate-200">{sourceFilename}</strong>
          </span>
        </div>
      )}

      <div className="space-y-2">
        <textarea
          value={playbookDraft}
          onChange={(e) => {
            setPlaybookDraft(e.target.value);
            setDirty(true);
          }}
          rows={compact ? 6 : 9}
          placeholder={`Exemplo:\n- O que a empresa faz e principais serviços/produtos\n- Horário de atendimento e entregas\n- Equipe e responsabilidades (ex: João cuida do financeiro, Maria do atendimento)\n- Regras de orçamento, prazos e garantias`}
          className="w-full rounded-xl border border-slate-700/80 bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {playbookDraft.length.toLocaleString("pt-BR")} caracteres
          </span>
          <Button
            type="button"
            size="sm"
            disabled={saveMutation.isPending || !dirty}
            onClick={() =>
              saveMutation.mutate({
                companyPlaybook: playbookDraft,
                sourceFilename,
              })
            }
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saveMutation.isPending ? "Salvando..." : "Salvar Roteiro"}
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Regras &amp; Rotinas Aprendidas via Chat ({learnedUpdates.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Atualizadas automaticamente ao conversar com o Assistente IA
          </span>
        </div>

        {learnedUpdates.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            Nenhuma regra aprendida via conversa ainda. Explique uma rotina ou mudança ao Assistente IA no chat e ele registrará aqui automaticamente.
          </p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {learnedUpdates.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                    {item.topic}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(item.updatedAt).toLocaleString("pt-BR")} • {item.author}
                  </span>
                </div>
                <p className="text-slate-200">{item.summary}</p>
                {item.previousRule && (
                  <p className="text-[11px] text-slate-500 line-through">
                    Anterior: {item.previousRule}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

