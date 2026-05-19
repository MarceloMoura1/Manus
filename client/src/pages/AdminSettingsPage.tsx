import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MessageSquare, Check, AlertCircle, Loader2, Eye, EyeOff, Upload, Building2, Lock, Wifi, WifiOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

interface AdminSettingsPageProps {
  clientId: string;
}

export function AdminSettingsPage({ clientId }: AdminSettingsPageProps) {
  const { user } = useAuth();
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Verificar se o usuário é admin
  if (!user || (user as any)?.role !== "admin") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Lock className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900">Acesso Restrito</h3>
          <p className="text-slate-600 mt-2">Apenas administradores podem acessar as configurações.</p>
        </div>
      </div>
    );
  }

  // Company form state
  const [companyFormData, setCompanyFormData] = useState({
    companyName: "",
    logoUrl: "",
    primaryEmail: "",
    primaryPhone: "",
    primaryWhatsapp: "",
    address: "",
    businessHoursStart: "",
    businessHoursEnd: "",
  });

  // Fetch WhatsApp config
  const { data: whatsappConfig, isLoading: isLoadingConfig, refetch: refetchConfig } = trpc.whatsapp.getConfig.useQuery(
    { clientId },
    { enabled: !!clientId }
  );

  // Fetch Company settings
  const { data: companySettings, isLoading: isLoadingCompany, refetch: refetchCompany } = trpc.company.getSettings.useQuery(
    { clientId },
    { enabled: !!clientId }
  );

  // Mutations
  const saveConfigMutation = trpc.whatsapp.saveConfig.useMutation();
  const testConnectionMutation = trpc.whatsapp.testConnection.useMutation();
  const saveCompanyMutation = trpc.company.saveSettings.useMutation();

  // Form state
  const [formData, setFormData] = useState({
    phoneNumberId: whatsappConfig?.phoneNumberId || "",
    businessAccountId: whatsappConfig?.businessAccountId || "",
    accessToken: "",
    webhookVerifyToken: whatsappConfig?.webhookVerifyToken || "",
    phoneNumber: whatsappConfig?.phoneNumber || "",
    webhookUrl: whatsappConfig?.webhookUrl || "",
  });

  // Update form when config loads
  React.useEffect(() => {
    if (whatsappConfig) {
      setFormData((prev) => ({
        ...prev,
        phoneNumberId: whatsappConfig.phoneNumberId,
        businessAccountId: whatsappConfig.businessAccountId,
        webhookVerifyToken: whatsappConfig.webhookVerifyToken,
        phoneNumber: whatsappConfig.phoneNumber || "",
        webhookUrl: whatsappConfig.webhookUrl || "",
      }));
    }
  }, [whatsappConfig]);

  // Update company form when settings load
  React.useEffect(() => {
    if (companySettings) {
      setCompanyFormData({
        companyName: companySettings.companyName || "",
        logoUrl: companySettings.logoUrl || "",
        primaryEmail: companySettings.primaryEmail || "",
        primaryPhone: companySettings.primaryPhone || "",
        primaryWhatsapp: companySettings.primaryWhatsapp || "",
        address: companySettings.address || "",
        businessHoursStart: companySettings.businessHoursStart || "",
        businessHoursEnd: companySettings.businessHoursEnd || "",
      });
    }
  }, [companySettings]);

  const handleSaveCompany = async () => {
    try {
      await saveCompanyMutation.mutateAsync({
        clientId,
        ...companyFormData,
      });
      toast.success("Configurações da empresa salvas com sucesso!");
      refetchCompany();
    } catch (error) {
      toast.error("Erro ao salvar configurações da empresa");
    }
  };

  const handleSaveWhatsApp = async () => {
    try {
      await saveConfigMutation.mutateAsync({
        clientId,
        phoneNumberId: formData.phoneNumberId,
        businessAccountId: formData.businessAccountId,
        accessToken: formData.accessToken || whatsappConfig?.accessToken || "",
        webhookVerifyToken: formData.webhookVerifyToken,
        phoneNumber: formData.phoneNumber,
        webhookUrl: formData.webhookUrl,
      });
      toast.success("Configurações WhatsApp salvas com sucesso!");
      refetchConfig();
    } catch (error) {
      toast.error("Erro ao salvar configurações WhatsApp");
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      await testConnectionMutation.mutateAsync({ clientId });
      toast.success("Conexão WhatsApp validada com sucesso!");
    } catch (error) {
      toast.error("Erro ao testar conexão WhatsApp");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Configurações Admin</h1>
          <p className="text-slate-600 mt-2">Gerencie as configurações da sua empresa e integrações</p>
        </div>

        <Tabs defaultValue="whatsapp" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white border border-slate-200">
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="geral" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Geral
            </TabsTrigger>
          </TabsList>

          {/* Aba WhatsApp - PRINCIPAL */}
          <TabsContent value="whatsapp" className="space-y-6">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle>Integração WhatsApp Business</CardTitle>
                <CardDescription>Configure sua conta WhatsApp para integração completa com a plataforma</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoadingConfig ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : (
                  <>
                    {/* Status Cards - Visão Geral */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      {/* Status de Conexão */}
                      <div className={`p-4 rounded-lg border-2 transition ${
                        whatsappConfig?.phoneNumber
                          ? 'bg-green-50 border-green-300'
                          : 'bg-amber-50 border-amber-300'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {whatsappConfig?.phoneNumber ? (
                            <>
                              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                              <span className="font-semibold text-green-900">Conectado</span>
                            </>
                          ) : (
                            <>
                              <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
                              <span className="font-semibold text-amber-900">Não Configurado</span>
                            </>
                          )}
                        </div>
                        {whatsappConfig?.phoneNumber && (
                          <p className="text-xs text-slate-600">
                            Número: <strong>{whatsappConfig.phoneNumber}</strong>
                          </p>
                        )}
                      </div>

                      {/* Status do Webhook */}
                      <div className={`p-4 rounded-lg border-2 transition ${
                        whatsappConfig?.webhookUrl
                          ? 'bg-blue-50 border-blue-300'
                          : 'bg-gray-50 border-gray-300'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {whatsappConfig?.webhookUrl ? (
                            <>
                              <Wifi className="w-4 h-4 text-blue-600" />
                              <span className="font-semibold text-blue-900">Webhook Ativo</span>
                            </>
                          ) : (
                            <>
                              <WifiOff className="w-4 h-4 text-gray-500" />
                              <span className="font-semibold text-gray-700">Webhook Inativo</span>
                            </>
                          )}
                        </div>
                        {whatsappConfig?.webhookUrl && (
                          <p className="text-xs text-slate-600 truncate">
                            {whatsappConfig.webhookUrl}
                          </p>
                        )}
                      </div>

                      {/* Status de Credenciais */}
                      <div className={`p-4 rounded-lg border-2 transition ${
                        whatsappConfig?.accessToken
                          ? 'bg-purple-50 border-purple-300'
                          : 'bg-gray-50 border-gray-300'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {whatsappConfig?.accessToken ? (
                            <>
                              <Check className="w-4 h-4 text-purple-600" />
                              <span className="font-semibold text-purple-900">Credenciais OK</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 text-gray-500" />
                              <span className="font-semibold text-gray-700">Sem Credenciais</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">
                          {whatsappConfig?.accessToken ? 'Token configurado' : 'Adicione um token'}
                        </p>
                      </div>
                    </div>

                    {/* Informações de Integração */}
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6">
                      <h4 className="font-semibold text-blue-900 mb-3">📖 Como Integrar WhatsApp</h4>
                      <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                        <li>Acesse <strong>Meta Business Manager</strong> e obtenha seu <strong>Phone Number ID</strong> e <strong>Business Account ID</strong></li>
                        <li>Gere um <strong>Access Token</strong> com permissões de WhatsApp Business API</li>
                        <li>Configure a <strong>Webhook URL</strong> em seu aplicativo WhatsApp (use a URL abaixo)</li>
                        <li>Use o <strong>Webhook Verify Token</strong> para validar requisições da Meta</li>
                        <li>Clique em <strong>Testar Conexão</strong> para confirmar a integração</li>
                      </ol>
                    </div>

                    {/* Webhook URL para Copiar */}
                    {clientId && (
                      <div className="p-4 bg-slate-100 border border-slate-300 rounded-lg">
                        <Label className="text-slate-700 font-medium mb-2 block">URL do Webhook para Meta</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={`${window.location.origin}/api/webhooks/whatsapp/${clientId}`}
                            className="border border-slate-300 bg-white"
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/whatsapp/${clientId}`);
                              toast.success("URL copiada!");
                            }}
                            className="border-slate-300"
                          >
                            Copiar
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Formulário de Configuração */}
                    <div className="border-t border-slate-200 pt-6">
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Dados de Integração</h3>

                      {/* Phone Number ID */}
                      <div className="space-y-2 mb-4">
                        <Label htmlFor="phoneNumberId" className="text-slate-700 font-medium">
                          Phone Number ID *
                        </Label>
                        <Input
                          id="phoneNumberId"
                          placeholder="Ex: 123456789012345"
                          value={formData.phoneNumberId}
                          onChange={(e) =>
                            setFormData({ ...formData, phoneNumberId: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                        <p className="text-xs text-slate-500">Encontre em Meta Business Manager → WhatsApp → Configurações</p>
                      </div>

                      {/* Business Account ID */}
                      <div className="space-y-2 mb-4">
                        <Label htmlFor="businessAccountId" className="text-slate-700 font-medium">
                          Business Account ID *
                        </Label>
                        <Input
                          id="businessAccountId"
                          placeholder="Ex: 987654321098765"
                          value={formData.businessAccountId}
                          onChange={(e) =>
                            setFormData({ ...formData, businessAccountId: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                        <p className="text-xs text-slate-500">ID da sua conta de negócios no Meta</p>
                      </div>

                      {/* Access Token */}
                      <div className="space-y-2 mb-4">
                        <Label htmlFor="accessToken" className="text-slate-700 font-medium">
                          Access Token *
                        </Label>
                        <div className="relative">
                          <Input
                            id="accessToken"
                            type={showAccessToken ? "text" : "password"}
                            placeholder="Seu token de acesso (será criptografado)"
                            value={formData.accessToken}
                            onChange={(e) =>
                              setFormData({ ...formData, accessToken: e.target.value })
                            }
                            className="border border-slate-300 pr-10"
                          />
                          <button
                            onClick={() => setShowAccessToken(!showAccessToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                          >
                            {showAccessToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-slate-500">Token gerado em Meta Business Manager com permissões de WhatsApp</p>
                      </div>

                      {/* Webhook Verify Token */}
                      <div className="space-y-2 mb-4">
                        <Label htmlFor="webhookVerifyToken" className="text-slate-700 font-medium">
                          Webhook Verify Token *
                        </Label>
                        <div className="relative">
                          <Input
                            id="webhookVerifyToken"
                            type={showWebhookToken ? "text" : "password"}
                            placeholder="Token para validar webhooks (crie um token seguro)"
                            value={formData.webhookVerifyToken}
                            onChange={(e) =>
                              setFormData({ ...formData, webhookVerifyToken: e.target.value })
                            }
                            className="border border-slate-300 pr-10"
                          />
                          <button
                            onClick={() => setShowWebhookToken(!showWebhookToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                          >
                            {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-slate-500">Use este token em Meta Business Manager para validar webhooks</p>
                      </div>

                      {/* Número de Telefone */}
                      <div className="space-y-2 mb-4">
                        <Label htmlFor="phoneNumber" className="text-slate-700 font-medium">
                          Número de Telefone
                        </Label>
                        <Input
                          id="phoneNumber"
                          placeholder="+55 11 99999-9999"
                          value={formData.phoneNumber}
                          onChange={(e) =>
                            setFormData({ ...formData, phoneNumber: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                        <p className="text-xs text-slate-500">Número WhatsApp Business vinculado</p>
                      </div>

                      {/* Webhook URL */}
                      <div className="space-y-2 mb-6">
                        <Label htmlFor="webhookUrl" className="text-slate-700 font-medium">
                          Webhook URL
                        </Label>
                        <Input
                          id="webhookUrl"
                          placeholder="https://seu-dominio.com/api/webhooks/whatsapp"
                          value={formData.webhookUrl}
                          onChange={(e) =>
                            setFormData({ ...formData, webhookUrl: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                        <p className="text-xs text-slate-500">URL onde receberemos eventos do WhatsApp</p>
                      </div>

                      {/* Botões de Ação */}
                      <div className="flex gap-3">
                        <Button
                          onClick={handleSaveWhatsApp}
                          disabled={saveConfigMutation.isPending}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          {saveConfigMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Salvando...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4 mr-2" />
                              Salvar Configurações
                            </>
                          )}
                        </Button>

                        <Button
                          onClick={handleTestConnection}
                          disabled={isTesting}
                          variant="outline"
                          className="border-slate-300"
                        >
                          {isTesting ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Testando...
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 mr-2" />
                              Testar Conexão
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba Geral */}
          <TabsContent value="geral" className="space-y-6">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle>Informações da Empresa</CardTitle>
                <CardDescription>Configure os dados básicos da sua empresa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoadingCompany ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : (
                  <>
                    {/* Nome da Empresa */}
                    <div className="space-y-2">
                      <Label htmlFor="companyName" className="text-slate-700 font-medium">
                        Nome da Empresa
                      </Label>
                      <Input
                        id="companyName"
                        placeholder="Ex: Acme Corporation"
                        value={companyFormData.companyName}
                        onChange={(e) =>
                          setCompanyFormData({ ...companyFormData, companyName: e.target.value })
                        }
                        className="border border-slate-300"
                      />
                    </div>

                    {/* Logo */}
                    <div className="space-y-2">
                      <Label htmlFor="logoUrl" className="text-slate-700 font-medium">
                        URL da Logo
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="logoUrl"
                          placeholder="https://exemplo.com/logo.png"
                          value={companyFormData.logoUrl}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, logoUrl: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                        <Button variant="outline" size="icon" className="border-slate-300">
                          <Upload className="w-4 h-4" />
                        </Button>
                      </div>
                      {companyFormData.logoUrl && (
                        <img
                          src={companyFormData.logoUrl}
                          alt="Logo preview"
                          className="h-16 w-16 object-contain rounded border border-slate-200"
                        />
                      )}
                    </div>

                    {/* Email Principal */}
                    <div className="space-y-2">
                      <Label htmlFor="primaryEmail" className="text-slate-700 font-medium">
                        E-mail Principal
                      </Label>
                      <Input
                        id="primaryEmail"
                        type="email"
                        placeholder="contato@empresa.com"
                        value={companyFormData.primaryEmail}
                        onChange={(e) =>
                          setCompanyFormData({ ...companyFormData, primaryEmail: e.target.value })
                        }
                        className="border border-slate-300"
                      />
                    </div>

                    {/* Telefone */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="primaryPhone" className="text-slate-700 font-medium">
                          Telefone
                        </Label>
                        <Input
                          id="primaryPhone"
                          placeholder="(11) 9999-9999"
                          value={companyFormData.primaryPhone}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, primaryPhone: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                      </div>

                      {/* WhatsApp Principal */}
                      <div className="space-y-2">
                        <Label htmlFor="primaryWhatsapp" className="text-slate-700 font-medium">
                          WhatsApp Principal
                        </Label>
                        <Input
                          id="primaryWhatsapp"
                          placeholder="+55 11 99999-9999"
                          value={companyFormData.primaryWhatsapp}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, primaryWhatsapp: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                      </div>
                    </div>

                    {/* Endereço */}
                    <div className="space-y-2">
                      <Label htmlFor="address" className="text-slate-700 font-medium">
                        Endereço
                      </Label>
                      <Input
                        id="address"
                        placeholder="Rua, número, cidade, estado"
                        value={companyFormData.address}
                        onChange={(e) =>
                          setCompanyFormData({ ...companyFormData, address: e.target.value })
                        }
                        className="border border-slate-300"
                      />
                    </div>

                    {/* Horário de Funcionamento */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="businessHoursStart" className="text-slate-700 font-medium">
                          Horário de Abertura
                        </Label>
                        <Input
                          id="businessHoursStart"
                          type="time"
                          value={companyFormData.businessHoursStart}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, businessHoursStart: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="businessHoursEnd" className="text-slate-700 font-medium">
                          Horário de Fechamento
                        </Label>
                        <Input
                          id="businessHoursEnd"
                          type="time"
                          value={companyFormData.businessHoursEnd}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, businessHoursEnd: e.target.value })
                          }
                          className="border border-slate-300"
                        />
                      </div>
                    </div>

                    {/* Botão Salvar */}
                    <Button
                      onClick={handleSaveCompany}
                      disabled={saveCompanyMutation.isPending}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {saveCompanyMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Salvar Configurações
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
