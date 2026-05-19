'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Trash2, Send, Edit2, Check } from 'lucide-react';

interface BotScript {
  scriptId: string;
  clientId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  initialMessage: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function BotConfigPage() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<BotScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<BotScript | null>(null);

  // Estados do formulário
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formInitialMsg, setFormInitialMsg] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Estados de edição
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');

  // Estados do chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  // Obter clientId da sessão
  useEffect(() => {
    try {
      const SESSION_KEY = 'megadesk_session_v1';
      const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        setClientId(session.clientId);
      }
    } catch (e) {
      console.error('Erro ao obter clientId:', e);
    }
  }, []);

  // Mutations
  const createScriptMutation = trpc.botScripts.create.useMutation();
  const updateScriptMutation = trpc.botScripts.update.useMutation();
  const deleteScriptMutation = trpc.botScripts.delete.useMutation();
  const activateScriptMutation = trpc.botScripts.activate.useMutation();
  const deactivateScriptMutation = trpc.botScripts.deactivate.useMutation();
  const { data: scriptsData, refetch: refetchScripts } = trpc.botScripts.list.useQuery(
    { clientId: clientId || '' },
    { enabled: !!clientId }
  );
  const testScriptMutation = trpc.botScripts.testScript.useMutation();

  // Carregar roteiros
  useEffect(() => {
    if (scriptsData) {
      setScripts(scriptsData);
    }
  }, [scriptsData]);

  const loadScripts = async () => {
    if (refetchScripts) {
      await refetchScripts();
    }
  };

  const handleCreateScript = async () => {
    if (!clientId || !formName.trim() || !formPrompt.trim()) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    setIsCreating(true);
    try {
      await createScriptMutation.mutateAsync({
        clientId,
        name: formName,
        description: formDescription,
        systemPrompt: formPrompt,
        initialMessage: formInitialMsg,
      });

      toast.success('Roteiro criado com sucesso!');
      setFormName('');
      setFormDescription('');
      setFormPrompt('');
      setFormInitialMsg('');
      await loadScripts();
    } catch (error) {
      console.error('Erro ao criar roteiro:', error);
      toast.error('Erro ao criar roteiro');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdatePrompt = async (scriptId: string) => {
    if (!clientId || !editingPrompt.trim()) {
      toast.error('Preencha o System Prompt');
      return;
    }

    try {
      await updateScriptMutation.mutateAsync({
        clientId,
        scriptId,
        systemPrompt: editingPrompt,
      });

      toast.success('Roteiro atualizado com sucesso!');
      setEditingScriptId(null);
      setEditingPrompt('');
      await loadScripts();
    } catch (error) {
      console.error('Erro ao atualizar roteiro:', error);
      toast.error('Erro ao atualizar roteiro');
    }
  };

  const handleDeleteScript = async (scriptId: string) => {
    if (!clientId) return;

    if (!confirm('Tem certeza que deseja deletar este roteiro?')) return;

    try {
      await deleteScriptMutation.mutateAsync({ clientId, scriptId });
      toast.success('Roteiro deletado com sucesso!');
      if (selectedScript?.scriptId === scriptId) {
        setSelectedScript(null);
        setChatMessages([]);
      }
      await loadScripts();
    } catch (error) {
      console.error('Erro ao deletar roteiro:', error);
      toast.error('Erro ao deletar roteiro');
    }
  };

  const handleActivateScript = async (scriptId: string) => {
    if (!clientId) return;

    try {
      await activateScriptMutation.mutateAsync({ clientId, scriptId });
      toast.success('Roteiro ativado!');
      await loadScripts();
    } catch (error) {
      console.error('Erro ao ativar roteiro:', error);
      toast.error('Erro ao ativar roteiro');
    }
  };

  const handleDeactivateScript = async (scriptId: string) => {
    if (!clientId) return;

    try {
      await deactivateScriptMutation.mutateAsync({ clientId, scriptId });
      toast.success('Roteiro desativado!');
      await loadScripts();
    } catch (error) {
      console.error('Erro ao desativar roteiro:', error);
      toast.error('Erro ao desativar roteiro');
    }
  };

  const handleSelectScript = (script: BotScript) => {
    setSelectedScript(script);
    setChatMessages([
      {
        role: 'assistant',
        content: script.initialMessage || 'Olá! Como posso ajudá-lo?',
        timestamp: new Date(),
      },
    ]);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedScript || !clientId) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: chatInput,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsLoadingChat(true);

    try {
      const response = await testScriptMutation.mutateAsync({
        clientId,
        scriptId: selectedScript.scriptId,
        userMessage: chatInput,
        conversationHistory: chatMessages,
      });

      const botMessage: ChatMessage = {
        role: 'assistant',
        content: response.botResponse || 'Desculpe, houve um erro na resposta.',
        timestamp: new Date(),
      };

      setChatMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setIsLoadingChat(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Configuração do Bot</h1>
          <p className="text-slate-600 mt-2">Crie e teste roteiros de IA para sua plataforma</p>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 px-40">
          {/* Painel Esquerdo: Novo Roteiro */}
          <div className="lg:col-span-1">
            <Card className="p-6 bg-white shadow-sm border-slate-200" style={{marginLeft: '-381px', marginRight: '235px', marginBottom: '7px'}}>
              <h2 className="text-xl font-bold text-slate-900 mb-6">Novo Roteiro</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nome</label>
                  <Input
                    placeholder="Ex: Suporte Técnico"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Descrição</label>
                  <Input
                    placeholder="Descrição do roteiro"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">System Prompt</label>
                  <Textarea
                    placeholder="Instruções para o bot..."
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                    rows={4}
                    className="border-slate-300 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Mensagem Inicial</label>
                  <Textarea
                    placeholder="Mensagem de boas-vindas"
                    value={formInitialMsg}
                    onChange={(e) => setFormInitialMsg(e.target.value)}
                    rows={3}
                    className="border-slate-300 resize-none"
                  />
                </div>

                <Button
                  onClick={handleCreateScript}
                  disabled={isCreating}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg"
                >
                  {isCreating ? 'Criando...' : '+ Criar Roteiro'}
                </Button>
              </div>
            </Card>
          </div>

          {/* Painel Central: Roteiros */}
          <div className="lg:col-span-1">
            <Card className="p-6 bg-white shadow-sm border-slate-200" style={{marginLeft: '-249px', marginRight: '168px', paddingLeft: '26px', paddingRight: '34px'}}>
              <h2 className="text-xl font-bold text-slate-900 mb-6">Roteiros</h2>

              <div className="space-y-4 max-h-96 overflow-y-auto">
                {scripts.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">Nenhum roteiro criado</p>
                ) : (
                  scripts.map((script) => (
                    <div
                      key={script.scriptId}
                      className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all duration-200 cursor-pointer group"
                      onClick={() => handleSelectScript(script)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900 text-base mb-1 group-hover:text-blue-600 transition">{script.name}</h3>
                          {script.description && (
                            <p className="text-sm text-slate-500 line-clamp-1">{script.description}</p>
                          )}
                        </div>
                        {script.isActive && (
                          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 ml-2 flex-shrink-0">Ativo</Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap pt-3 border-t border-slate-100">
                        {script.isActive ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeactivateScript(script.scriptId);
                              }}
                              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs"
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Desativar
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleActivateScript(script.scriptId);
                            }}
                            className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs"
                          >
                            <Check className="w-4 h-4 mr-1" />
                            Ativar
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingScriptId(script.scriptId);
                            setEditingPrompt(script.systemPrompt);
                          }}
                          className="text-blue-600 hover:bg-blue-50 p-1.5 h-auto"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteScript(script.scriptId);
                          }}
                          className="text-red-600 hover:bg-red-50 p-1.5 h-auto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Modal de Edição */}
                      {editingScriptId === script.scriptId && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Editar System Prompt
                          </label>
                          <Textarea
                            value={editingPrompt}
                            onChange={(e) => setEditingPrompt(e.target.value)}
                            rows={4}
                            className="border-slate-300 resize-none mb-3"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleUpdatePrompt(script.scriptId)}
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingScriptId(null);
                                setEditingPrompt('');
                              }}
                              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs"
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* Painel Direito: Teste do Roteiro */}
          <div className="lg:col-span-2">
            <Card className="p-6 bg-white shadow-sm border-slate-200 flex flex-col h-full" style={{marginLeft: '-183px', marginRight: '-317px'}}>
              <h2 className="text-xl font-bold text-slate-900 mb-6">Teste do Roteiro</h2>

              {!selectedScript ? (
                <div className="flex items-center justify-center flex-1 text-slate-500">
                  <p>Selecione um roteiro para testar</p>
                </div>
              ) : (
                <div className="flex flex-col flex-1">
                  {/* Chat Messages */}
                  <div className="flex-1 overflow-y-auto mb-4 space-y-3 bg-slate-50 rounded-lg p-4">
                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-xs px-4 py-2 rounded-lg ${
                            msg.role === 'user'
                              ? 'bg-blue-600 text-white rounded-br-none'
                              : 'bg-slate-200 text-slate-900 rounded-bl-none'
                          }`}
                        >
                          <p className="text-sm">{msg.content}</p>
                          <p className="text-xs mt-1 opacity-70">
                            {msg.timestamp.toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                    {isLoadingChat && (
                      <div className="flex justify-start">
                        <div className="bg-slate-200 text-slate-900 px-4 py-2 rounded-lg rounded-bl-none">
                          <p className="text-sm">Digitando...</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      disabled={isLoadingChat}
                      className="border-slate-300"
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={isLoadingChat || !chatInput.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
