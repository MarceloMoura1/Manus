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
  
  // Aba: WhatsApp - Estados dos campos
  const [phoneNumberId, setPhoneNumberId] = React.useState('');
  const [businessAccountId, setBusinessAccountId] = React.useState('');
  const [accessToken, setAccessToken] = React.useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = React.useState('');
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [testingConnection, setTestingConnection] = React.useState(false);
  
  // Estados de validação
  const [connectionStatus, setConnectionStatus] = React.useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [webhookStatus, setWebhookStatus] = React.useState<'active' | 'inactive' | 'testing'>('inactive');
  const [credentialsStatus, setCredentialsStatus] = React.useState<'valid' | 'invalid' | 'checking'>('invalid');
  
  // Função para validar credenciais
  const validateCredentials = React.useCallback(() => {
    const isPhoneNumberIdValid = /^\d{1,}$/.test(phoneNumberId) && phoneNumberId.length >= 10;
    const isBusinessAccountIdValid = /^\d{1,}$/.test(businessAccountId) && businessAccountId.length >= 10;
    const isAccessTokenValid = accessToken.length >= 20;
    const isWebhookTokenValid = webhookVerifyToken.length >= 8;
    const isPhoneNumberValid = /^\+?\d{10,}$/.test(phoneNumber.replace(/[\s-]/g, ''));
    
    const allValid = isPhoneNumberIdValid && isBusinessAccountIdValid && isAccessTokenValid && isWebhookTokenValid && isPhoneNumberValid;
    
    setCredentialsStatus(allValid ? 'valid' : 'invalid');
    if (allValid) {
      setWebhookStatus('active');
    } else {
      setWebhookStatus('inactive');
    }
  }, [phoneNumberId, businessAccountId, accessToken, webhookVerifyToken, phoneNumber]);
  
  // Chamar validação quando campos mudam
  React.useEffect(() => {
    validateCredentials();
  }, [phoneNumberId, businessAccountId, accessToken, webhookVerifyToken, phoneNumber, validateCredentials]);
  
  // Função para testar conexão
  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('testing');
    
    try {
      // Simular teste de conexão
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (credentialsStatus === 'valid') {
        setConnectionStatus('connected');
        toast.success('Conexão com WhatsApp estabelecida com sucesso!');
      } else {
        setConnectionStatus('disconnected');
        toast.error('Falha ao conectar. Verifique as credenciais.');
      }
    } catch (error) {
      setConnectionStatus('disconnected');
      toast.error('Erro ao testar conexão.');
    } finally {
      setTestingConnection(false);
    }
  };
  
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
  });

  // Aba: Atendimento
  const [attendanceSettings, setAttendanceSettings] = React.useState({
    autoReplyEnabled: false,
    autoReplyMessage: '',
    shortcuts: [] as Array<{ key: string; message: string }>,
  });

  const [newShortcutKey, setNewShortcutKey] = React.useState('');
  const [newShortcutMessage, setNewShortcutMessage] = React.useState('');

  const addShortcut = () => {
    if (newShortcutKey && newShortcutMessage) {
      setAttendanceSettings(prev => ({
        ...prev,
        shortcuts: [...prev.shortcuts, { key: newShortcutKey, message: newShortcutMessage }],
      }));
      setNewShortcutKey('');
      setNewShortcutMessage('');
      toast.success('Atalho adicionado!');
    }
  };

  const removeShortcut = (index: number) => {
    setAttendanceSettings(prev => ({
      ...prev,
      shortcuts: prev.shortcuts.filter((_, i) => i !== index),
    }));
    toast.success('Atalho removido!');
  };

  // Função para renderizar card de status
  const renderStatusCard = (title: string, status: 'connected' | 'disconnected' | 'testing' | 'active' | 'inactive' | 'valid' | 'invalid' | 'checking', description: string) => {
    const getStatusColor = () => {
      if (status === 'connected' || status === 'active' || status === 'valid') return 'bg-green-50 border-green-200';
      if (status === 'testing' || status === 'checking') return 'bg-blue-50 border-blue-200';
      return 'bg-red-50 border-red-200';
    };

    const getStatusIcon = () => {
      if (status === 'connected' || status === 'active' || status === 'valid') return <Check className="w-6 h-6 text-green-600" />;
      if (status === 'testing' || status === 'checking') return <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />;
      return <AlertCircle className="w-6 h-6 text-red-600" />;
    };

    const getStatusText = () => {
      if (status === 'connected') return 'Conectado';
      if (status === 'active') return 'Ativo';
      if (status === 'valid') return 'Válidas';
      if (status === 'testing' || status === 'checking') return 'Verificando...';
      if (status === 'disconnected') return 'Desconectado';
      if (status === 'inactive') return 'Inativo';
      return 'Inválidas';
    };

    const getStatusTextColor = () => {
      if (status === 'connected' || status === 'active' || status === 'valid') return 'text-green-700';
      if (status === 'testing' || status === 'checking') return 'text-blue-700';
      return 'text-red-700';
    };

    return (
      <Card className={`border-2 transition-all ${getStatusColor()}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{title}</p>
              <p className={`text-lg font-bold ${getStatusTextColor()}`}>{getStatusText()}</p>
            </div>
            {getStatusIcon()}
          </div>
          <p className="text-xs text-gray-500 mt-2">{description}</p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground mt-2">Personalize sua experiência no MegaDesk</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
            <TabsTrigger value="account">Conta</TabsTrigger>
            <TabsTrigger value="notifications">Notificações</TabsTrigger>
            <TabsTrigger value="attendance">Atendimento</TabsTrigger>
          </TabsList>

          {/* Aba: WhatsApp */}
          <TabsContent value="whatsapp" className="space-y-6">
            {/* Cards de Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {renderStatusCard('Status de Conexão', connectionStatus, 'Conexão com WhatsApp API')}
              {renderStatusCard('Webhook', webhookStatus, 'Status do webhook para receber mensagens')}
              {renderStatusCard('Credenciais', credentialsStatus, 'Validação das credenciais fornecidas')}
            </div>

            {/* Instruções */}
            <Card>
              <CardHeader>
                <CardTitle>Como Integrar WhatsApp</CardTitle>
                <CardDescription>Siga os passos abaixo para configurar sua integração</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  <li>1. Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Facebook Developers</a></li>
                  <li>2. Crie um app e configure WhatsApp Business API</li>
                  <li>3. Obtenha seu Phone Number ID, Business Account ID e Access Token</li>
                  <li>4. Preencha os campos abaixo com as informações</li>
                  <li>5. Configure o Webhook URL abaixo em seu app do Facebook</li>
                </ol>
              </CardContent>
            </Card>

            {/* URL do Webhook */}
            <Card>
              <CardHeader>
                <CardTitle>URL do Webhook</CardTitle>
                <CardDescription>Configure esta URL em seu app do Facebook</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={`${window.location.origin}/api/webhooks/whatsapp`}
                    readOnly
                    className="border-slate-300"
                  />
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/whatsapp`);
                      toast.success('URL copiada!');
                    }}
                    variant="outline"
                  >
                    Copiar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Configurar Credenciais */}
            <Card>
              <CardHeader>
                <CardTitle>Configurar Credenciais WhatsApp</CardTitle>
                <CardDescription>Preencha com as informações do seu app do Facebook</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Phone Number ID</label>
                  <Input
                    placeholder="Ex: 123456789012345"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">ID do número de telefone WhatsApp Business</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Business Account ID</label>
                  <Input
                    placeholder="Ex: 987654321098765"
                    value={businessAccountId}
                    onChange={(e) => setBusinessAccountId(e.target.value)}
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">ID da sua conta WhatsApp Business</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Access Token</label>
                  <Input
                    type="password"
                    placeholder="Cole seu token de acesso aqui"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
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
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">Número WhatsApp Business conectado</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Webhook URL</label>
                  <Input
                    type="text"
                    value={`${window.location.origin}/api/webhooks/whatsapp`}
                    readOnly
                    className="border-slate-300"
                  />
                  <p className="text-xs text-muted-foreground">URL automática para receber mensagens</p>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                    Salvar Configurações
                  </Button>
                  <Button
                    onClick={testConnection}
                    disabled={testingConnection || credentialsStatus !== 'valid'}
                    variant="outline"
                    className="flex-1"
                  >
                    {testingConnection ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testando...
                      </>
                    ) : (
                      <>
                        <Wifi className="w-4 h-4 mr-2" />
                        Testar Conexão
                      </>
                    )}
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
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Nome</label>
                  {editingName ? (
                    <div className="flex gap-2">
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="border-slate-300"
                      />
                      <Button
                        onClick={() => {
                          setEditingName(false);
                          toast.success('Nome atualizado!');
                        }}
                        size="sm"
                      >
                        Salvar
                      </Button>
                      <Button
                        onClick={() => setEditingName(false)}
                        variant="outline"
                        size="sm"
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2 border border-slate-300 rounded">
                      <span>{newName || 'Não informado'}</span>
                      <Button
                        onClick={() => setEditingName(true)}
                        variant="ghost"
                        size="sm"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Senha</label>
                  {editingPassword ? (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        placeholder="Senha atual"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="border-slate-300"
                      />
                      <Input
                        type="password"
                        placeholder="Nova senha"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="border-slate-300"
                      />
                      <Input
                        type="password"
                        placeholder="Confirmar nova senha"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="border-slate-300"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            if (newPassword === confirmPassword) {
                              setEditingPassword(false);
                              setCurrentPassword('');
                              setNewPassword('');
                              setConfirmPassword('');
                              toast.success('Senha atualizada!');
                            } else {
                              toast.error('As senhas não correspondem!');
                            }
                          }}
                          size="sm"
                        >
                          Salvar
                        </Button>
                        <Button
                          onClick={() => {
                            setEditingPassword(false);
                            setCurrentPassword('');
                            setNewPassword('');
                            setConfirmPassword('');
                          }}
                          variant="outline"
                          size="sm"
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2 border border-slate-300 rounded">
                      <span>••••••••</span>
                      <Button
                        onClick={() => setEditingPassword(true)}
                        variant="ghost"
                        size="sm"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
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
                <CardTitle>Configurações de Notificações</CardTitle>
                <CardDescription>Personalize como você recebe notificações</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Notificações Gerais</p>
                    <p className="text-sm text-muted-foreground">Ativar/desativar todas as notificações</p>
                  </div>
                  <Switch
                    checked={notificationSettings.notificationsEnabled}
                    onCheckedChange={(checked) =>
                      setNotificationSettings(prev => ({
                        ...prev,
                        notificationsEnabled: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Som de Notificação</p>
                    <p className="text-sm text-muted-foreground">Reproduzir som ao receber notificações</p>
                  </div>
                  <Switch
                    checked={notificationSettings.soundEnabled}
                    onCheckedChange={(checked) =>
                      setNotificationSettings(prev => ({
                        ...prev,
                        soundEnabled: checked,
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <p className="font-medium">Volume do Som</p>
                  <Slider
                    value={[notificationSettings.soundVolume]}
                    onValueChange={(value) =>
                      setNotificationSettings(prev => ({
                        ...prev,
                        soundVolume: value[0],
                      }))
                    }
                    max={100}
                    step={1}
                  />
                  <p className="text-sm text-muted-foreground">{notificationSettings.soundVolume}%</p>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <p className="font-medium">Tipos de Notificações</p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      <p>Notificações do WhatsApp</p>
                    </div>
                    <Switch
                      checked={notificationSettings.whatsappNotificationsEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationSettings(prev => ({
                          ...prev,
                          whatsappNotificationsEnabled: checked,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4" />
                      <p>Notificações de Chamados</p>
                    </div>
                    <Switch
                      checked={notificationSettings.ticketsNotificationsEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationSettings(prev => ({
                          ...prev,
                          ticketsNotificationsEnabled: checked,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4" />
                      <p>Notificações da IA</p>
                    </div>
                    <Switch
                      checked={notificationSettings.iaNotificationsEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationSettings(prev => ({
                          ...prev,
                          iaNotificationsEnabled: checked,
                        }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Atendimento */}
          <TabsContent value="attendance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Configurações de Atendimento</CardTitle>
                <CardDescription>Personalize sua experiência de atendimento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Resposta Automática</p>
                    <p className="text-sm text-muted-foreground">Enviar resposta automática quando offline</p>
                  </div>
                  <Switch
                    checked={attendanceSettings.autoReplyEnabled}
                    onCheckedChange={(checked) =>
                      setAttendanceSettings(prev => ({
                        ...prev,
                        autoReplyEnabled: checked,
                      }))
                    }
                  />
                </div>

                {attendanceSettings.autoReplyEnabled && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Mensagem de Resposta Automática</label>
                    <textarea
                      placeholder="Digite a mensagem que será enviada automaticamente..."
                      value={attendanceSettings.autoReplyMessage}
                      onChange={(e) =>
                        setAttendanceSettings(prev => ({
                          ...prev,
                          autoReplyMessage: e.target.value,
                        }))
                      }
                      className="w-full p-2 border border-slate-300 rounded text-sm"
                      rows={3}
                    />
                  </div>
                )}

                <div className="border-t pt-4 space-y-4">
                  <p className="font-medium">Atalhos de Mensagens</p>
                  <p className="text-sm text-muted-foreground">Digite / seguido da chave para usar o atalho</p>

                  <div className="space-y-2">
                    <Input
                      placeholder="Chave do atalho (ex: saudacao)"
                      value={newShortcutKey}
                      onChange={(e) => setNewShortcutKey(e.target.value)}
                      className="border-slate-300"
                    />
                    <textarea
                      placeholder="Mensagem do atalho..."
                      value={newShortcutMessage}
                      onChange={(e) => setNewShortcutMessage(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded text-sm"
                      rows={2}
                    />
                    <Button
                      onClick={addShortcut}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar Atalho
                    </Button>
                  </div>

                  {attendanceSettings.shortcuts.length > 0 && (
                    <div className="space-y-2">
                      {attendanceSettings.shortcuts.map((shortcut, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 border border-slate-300 rounded"
                        >
                          <div>
                            <p className="font-medium text-sm">/{shortcut.key}</p>
                            <p className="text-xs text-muted-foreground">{shortcut.message}</p>
                          </div>
                          <Button
                            onClick={() => removeShortcut(index)}
                            variant="ghost"
                            size="sm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
