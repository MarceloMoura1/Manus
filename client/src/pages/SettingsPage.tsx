import React from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus, Edit2, X, Lock, Bell, MessageSquare, Wifi, WifiOff, Check, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState('whatsapp');
  
  // Aba: WhatsApp
  const [webhookVerifyToken, setWebhookVerifyToken] = React.useState('');
  
  // Função para gerar token seguro
  const generateSecureToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setWebhookVerifyToken(token);
    toast.success('Token gerado com sucesso!');
  };
  
  // Aba: Conta
  const [editingName, setEditingName] = React.useState(false);
  const [newName, setNewName] = React.useState(user?.user?.name || '');
  const [editingPassword, setEditingPassword] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  // Aba: Notificações
  const [notificationSettings, setNotificationSettings] = React.useState({
    notificationsEnabled: true,
    soundEnabled: true,
    soundVolume: 70,
    desktopNotificationsEnabled: true,
    whatsappNotificationsEnabled: true,
    ticketsNotificationsEnabled: true,
    iaNotificationsEnabled: true,
    erpNotificationsEnabled: true,
    trackingNotificationsEnabled: true,
    showMessagePreview: true,
  });
  const [muteModalOpen, setMuteModalOpen] = React.useState(false);

  // Aba: Atendimento
  const [autoResponseEnabled, setAutoResponseEnabled] = React.useState(false);
  const [autoResponseMessage, setAutoResponseMessage] = React.useState('');
  const [shortcuts, setShortcuts] = React.useState<Array<{ key: string; message: string }>>([]);
  const [newShortcutKey, setNewShortcutKey] = React.useState('');
  const [newShortcutMessage, setNewShortcutMessage] = React.useState('');
  const [editingShortcutKey, setEditingShortcutKey] = React.useState<string | null>(null);
  const [editingShortcutMessage, setEditingShortcutMessage] = React.useState('');

  const handleSaveName = async () => {
    if (!newName.trim()) {
      toast.error('Nome não pode estar vazio');
      return;
    }
    // TODO: Implementar mutation para atualizar nome
    toast.success('Nome atualizado com sucesso');
    setEditingName(false);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Preencha todos os campos');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Senhas não conferem');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres');
      return;
    }
    // TODO: Implementar mutation para alterar senha
    toast.success('Senha alterada com sucesso');
    setEditingPassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleMuteNotifications = (minutes: number) => {
    // TODO: Implementar mutation para silenciar notificações
    toast.success(`Notificações silenciadas por ${minutes} minutos`);
    setMuteModalOpen(false);
  };

  const handleAddShortcut = () => {
    if (!newShortcutKey.trim() || !newShortcutMessage.trim()) {
      toast.error('Preencha todos os campos');
      return;
    }
    const normalizedKey = newShortcutKey.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setShortcuts([...shortcuts, { key: normalizedKey, message: newShortcutMessage }]);
    toast.success(`Atalho /${normalizedKey} criado com sucesso`);
    setNewShortcutKey('');
    setNewShortcutMessage('');
  };

  const handleDeleteShortcut = (key: string) => {
    setShortcuts(shortcuts.filter((s) => s.key !== key));
    toast.success('Atalho deletado com sucesso');
  };

  const handleSaveShortcut = (key: string) => {
    if (!editingShortcutMessage.trim()) {
      toast.error('Mensagem não pode estar vazia');
      return;
    }
    setShortcuts(shortcuts.map((s) => (s.key === key ? { ...s, message: editingShortcutMessage } : s)));
    toast.success('Atalho atualizado com sucesso');
    setEditingShortcutKey(null);
    setEditingShortcutMessage('');
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground mt-2">Personalize sua experiência no MegaDesk</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">WhatsApp</span>
            </TabsTrigger>
            <TabsTrigger value="account" className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">Conta</span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Notificações</span>
            </TabsTrigger>
            <TabsTrigger value="attendance" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Atendimento</span>
            </TabsTrigger>
          </TabsList>

          {/* Aba: WhatsApp */}
          <TabsContent value="whatsapp" className="space-y-6">
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-300">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Status de Conexão</p>
                      <p className="text-2xl font-bold text-green-700 mt-2">Conectado</p>
                    </div>
                    <Wifi className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Webhook</p>
                      <p className="text-2xl font-bold text-blue-700 mt-2">Ativo</p>
                    </div>
                    <Check className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-300">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Credenciais</p>
                      <p className="text-2xl font-bold text-purple-700 mt-2">Válidas</p>
                    </div>
                    <Check className="w-8 h-8 text-purple-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Instruções de Integração */}
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Como Integrar WhatsApp</CardTitle>
                <CardDescription>Siga os passos abaixo para configurar sua integração</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-600 min-w-fit">1.</span>
                    <span>Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Facebook Developers</a></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-600 min-w-fit">2.</span>
                    <span>Crie um app e configure WhatsApp Business API</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-600 min-w-fit">3.</span>
                    <span>Obtenha seu Phone Number ID, Business Account ID e Access Token</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-600 min-w-fit">4.</span>
                    <span>Preencha os campos abaixo com as informações</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-600 min-w-fit">5.</span>
                    <span>Configure o Webhook URL abaixo em seu app do Facebook</span>
                  </li>
                </ol>
              </CardContent>
            </Card>

            {/* Webhook URL */}
            <Card>
              <CardHeader>
                <CardTitle>URL do Webhook</CardTitle>
                <CardDescription>Configure esta URL em seu app do Facebook</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    value={`${window.location.origin}/api/webhooks/whatsapp`}
                    readOnly
                    className="bg-slate-100 border-slate-300"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/whatsapp`);
                      toast.success('URL copiada para a área de transferência');
                    }}
                  >
                    Copiar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Formulário de Configuração */}
            <Card>
              <CardHeader>
                <CardTitle>Configurar Credenciais WhatsApp</CardTitle>
                <CardDescription>Preencha com as informações do seu app do Facebook</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Phone Number ID</label>
                  <Input
                    placeholder="Ex: 123456789012345"
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">ID do número de telefone WhatsApp Business</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Business Account ID</label>
                  <Input
                    placeholder="Ex: 987654321098765"
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">ID da sua conta WhatsApp Business</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Access Token</label>
                  <Input
                    type="password"
                    placeholder="Cole seu token de acesso aqui"
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">Token de acesso da API do WhatsApp</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Webhook Verify Token</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={generateSecureToken}
                      className="text-blue-600 hover:text-blue-700 border-blue-200 text-xs"
                    >
                      Gerar Token
                    </Button>
                  </div>
                  <Input
                    type="password"
                    placeholder="Token para verificação do webhook"
                    value={webhookVerifyToken}
                    onChange={(e) => setWebhookVerifyToken(e.target.value)}
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">Token que você define para verificar requisições do webhook</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Número de Telefone</label>
                  <Input
                    placeholder="Ex: +5541987654321"
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">Número WhatsApp Business conectado</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Webhook URL</label>
                  <Input
                    value={`${window.location.origin}/api/webhooks/whatsapp`}
                    readOnly
                    className="bg-slate-100 border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">URL automática para receber mensagens</p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    Salvar Configurações
                  </Button>
                  <Button variant="outline">
                    Testar Conexão
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Conta */}
          <TabsContent value="account" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informações da Conta</CardTitle>
                <CardDescription>Gerencie suas informações pessoais</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Alterar Nome */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Nome</label>
                  {!editingName ? (
                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className="text-foreground">{newName}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingName(true)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Seu nome"
                        className="border-slate-300"
                      />
                      <div className="flex gap-2">
                        <Button onClick={handleSaveName} className="bg-blue-600 hover:bg-blue-700">
                          Salvar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingName(false);
                            setNewName(user?.user?.name || '');
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Alterar Senha */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Senha</label>
                  {!editingPassword ? (
                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className="text-muted-foreground">••••••••</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPassword(true)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Senha atual"
                        className="border-slate-300"
                      />
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Nova senha"
                        className="border-slate-300"
                      />
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirmar nova senha"
                        className="border-slate-300"
                      />
                      <div className="flex gap-2">
                        <Button onClick={handleChangePassword} className="bg-blue-600 hover:bg-blue-700">
                          Alterar Senha
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingPassword(false);
                            setCurrentPassword('');
                            setNewPassword('');
                            setConfirmPassword('');
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Notificações */}
          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notificações da Plataforma</CardTitle>
                <CardDescription>Controle como você recebe notificações</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Ativar/Desativar Notificações */}
                <div className={`flex items-center justify-between p-4 border border-slate-200 rounded-lg transition-colors ${
                  notificationSettings.notificationsEnabled
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div>
                    <p className="font-medium text-foreground">Notificações</p>
                    <p className="text-sm text-muted-foreground">Receber notificações da plataforma</p>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors ${
                    notificationSettings.notificationsEnabled
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  } flex items-center cursor-pointer`}
                    onClick={() =>
                      setNotificationSettings({ ...notificationSettings, notificationsEnabled: !notificationSettings.notificationsEnabled })
                    }
                  >
                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${
                      notificationSettings.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </div>

                {/* Som de Notificações */}
                <div className={`flex items-center justify-between p-4 border border-slate-200 rounded-lg transition-colors ${
                  notificationSettings.soundEnabled
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div>
                    <p className="font-medium text-foreground">Som de Notificações</p>
                    <p className="text-sm text-muted-foreground">Reproduzir som ao receber notificação</p>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors ${
                    notificationSettings.soundEnabled
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  } flex items-center cursor-pointer`}
                    onClick={() =>
                      setNotificationSettings({ ...notificationSettings, soundEnabled: !notificationSettings.soundEnabled })
                    }
                  >
                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${
                      notificationSettings.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </div>

                {/* Volume de Notificações */}
                {notificationSettings.soundEnabled && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">Volume</p>
                      <span className="text-sm text-muted-foreground">{notificationSettings.soundVolume}%</span>
                    </div>
                    <Slider
                      value={[notificationSettings.soundVolume]}
                      onValueChange={(value) =>
                        setNotificationSettings({ ...notificationSettings, soundVolume: value[0] })
                      }
                      min={0}
                      max={100}
                      step={10}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Silenciar Notificações */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-foreground">Silenciar Notificações</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMuteModalOpen(true)}
                      className="text-blue-600 hover:text-blue-700 border-blue-200"
                    >
                      Silenciar
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">Silencie temporariamente as notificações</p>
                </div>

                {/* Notificações Desktop */}
                <div className={`flex items-center justify-between p-4 border border-slate-200 rounded-lg transition-colors ${
                  notificationSettings.desktopNotificationsEnabled
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div>
                    <p className="font-medium text-foreground">Notificações Desktop</p>
                    <p className="text-sm text-muted-foreground">Receber notificações na área de trabalho</p>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors ${
                    notificationSettings.desktopNotificationsEnabled
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  } flex items-center cursor-pointer`}
                    onClick={() =>
                      setNotificationSettings({ ...notificationSettings, desktopNotificationsEnabled: !notificationSettings.desktopNotificationsEnabled })
                    }
                  >
                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${
                      notificationSettings.desktopNotificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </div>

                {/* Notificações por Tipo */}
                <div className="space-y-3">
                  <p className="font-medium text-foreground">Tipos de Notificações</p>
                  <div className="space-y-2">
                    {[
                      { key: 'whatsappNotificationsEnabled', label: 'WhatsApp' },
                      { key: 'ticketsNotificationsEnabled', label: 'Chamados' },
                      { key: 'iaNotificationsEnabled', label: 'IA' },
                      { key: 'erpNotificationsEnabled', label: 'ERP' },
                      { key: 'trackingNotificationsEnabled', label: 'Rastreamento' },
                    ].map((item) => {
                      const isEnabled = notificationSettings[item.key as keyof typeof notificationSettings] as boolean;
                      return (
                        <div key={item.key} className={`flex items-center justify-between p-3 border border-slate-200 rounded-lg transition-colors ${
                          isEnabled
                            ? 'bg-green-50 border-green-300'
                            : 'bg-red-50 border-red-300'
                        }`}>
                          <p className="text-foreground">{item.label}</p>
                          <div className={`w-12 h-7 rounded-full transition-colors ${
                            isEnabled
                              ? 'bg-green-500'
                              : 'bg-red-500'
                          } flex items-center cursor-pointer`}
                            onClick={() =>
                              setNotificationSettings({
                                ...notificationSettings,
                                [item.key]: !isEnabled,
                              })
                            }
                          >
                            <div className={`w-6 h-6 bg-white rounded-full transition-transform ${
                              isEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mostrar Preview */}
                <div className={`flex items-center justify-between p-4 border border-slate-200 rounded-lg transition-colors ${
                  notificationSettings.showMessagePreview
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div>
                    <p className="font-medium text-foreground">Mostrar Preview de Mensagem</p>
                    <p className="text-sm text-muted-foreground">Exibir conteúdo da mensagem na notificação</p>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors ${
                    notificationSettings.showMessagePreview
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  } flex items-center cursor-pointer`}
                    onClick={() =>
                      setNotificationSettings({ ...notificationSettings, showMessagePreview: !notificationSettings.showMessagePreview })
                    }
                  >
                    <div className={`w-6 h-6 bg-white rounded-full transition-transform ${
                      notificationSettings.showMessagePreview ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Atendimento */}
          <TabsContent value="attendance" className="space-y-6">
            {/* Resposta Automática */}
            <Card>
              <CardHeader>
                <CardTitle>Resposta Automática</CardTitle>
                <CardDescription>Configure uma resposta automática para suas mensagens</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <p className="font-medium text-foreground">Ativar Resposta Automática</p>
                    <p className="text-sm text-muted-foreground">Enviar resposta automática quando indisponível</p>
                  </div>
                  <Switch checked={autoResponseEnabled} onCheckedChange={setAutoResponseEnabled} />
                </div>

                {autoResponseEnabled && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">Mensagem de Resposta</label>
                    <textarea
                      value={autoResponseMessage}
                      onChange={(e) => setAutoResponseMessage(e.target.value)}
                      placeholder="Digite sua mensagem de resposta automática..."
                      className="w-full p-3 border border-slate-300 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={4}
                    />
                    <Button className="bg-blue-600 hover:bg-blue-700">Salvar Resposta Automática</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Atalhos de Mensagens */}
            <Card>
              <CardHeader>
                <CardTitle>Atalhos de Mensagens</CardTitle>
                <CardDescription>Crie atalhos com / para mensagens frequentes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Adicionar Novo Atalho */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <p className="font-medium text-foreground">Novo Atalho</p>
                  <div className="flex gap-2">
                    <Input
                      value={newShortcutKey}
                      onChange={(e) => setNewShortcutKey(e.target.value)}
                      placeholder="Comando (ex: ola, obrigado)"
                      className="flex-1 border-slate-300"
                    />
                    <Button onClick={handleAddShortcut} className="bg-blue-600 hover:bg-blue-700">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <textarea
                    value={newShortcutMessage}
                    onChange={(e) => setNewShortcutMessage(e.target.value)}
                    placeholder="Digite a mensagem que será enviada ao usar /{comando}"
                    className="w-full p-3 border border-slate-300 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                {/* Lista de Atalhos */}
                {shortcuts.length > 0 && (
                  <div className="space-y-3">
                    <p className="font-medium text-foreground">Seus Atalhos</p>
                    {shortcuts.map((shortcut) => (
                      <div key={shortcut.key} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                        {editingShortcutKey === shortcut.key ? (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-foreground">/{shortcut.key}</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingShortcutKey(null)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                            <textarea
                              value={editingShortcutMessage}
                              onChange={(e) => setEditingShortcutMessage(e.target.value)}
                              className="w-full p-3 border border-slate-300 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <Button
                                onClick={() => handleSaveShortcut(shortcut.key)}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                Salvar
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setEditingShortcutKey(null);
                                  setEditingShortcutMessage('');
                                }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-foreground">/{shortcut.key}</p>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingShortcutKey(shortcut.key);
                                    setEditingShortcutMessage(shortcut.message);
                                  }}
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteShortcut(shortcut.key)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground">{shortcut.message}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {shortcuts.length === 0 && (
                  <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-center">
                    <p className="text-muted-foreground">Nenhum atalho criado ainda</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal: Silenciar Notificações */}
      <Dialog open={muteModalOpen} onOpenChange={setMuteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Silenciar Notificações</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { minutes: 30, label: '30 minutos' },
              { minutes: 60, label: '1 hora' },
              { minutes: 480, label: '8 horas' },
              { minutes: 1440, label: '24 horas' },
            ].map((option) => (
              <Button
                key={option.minutes}
                onClick={() => handleMuteNotifications(option.minutes)}
                variant="outline"
                className="w-full justify-start"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
