import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MessageSquare, Check, AlertCircle, Loader2, Eye, EyeOff, Upload, Building2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AdminSettingsPageProps {
  clientId: string;
}

export function AdminSettingsPage({ clientId }: AdminSettingsPageProps) {
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

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

        <Tabs defaultValue="geral" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white border border-slate-200">
            <TabsTrigger value="geral" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              WhatsApp
            </TabsTrigger>
          </TabsList>

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
                        placeholder="Rua Exemplo, 123 - São Paulo, SP"
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

          {/* Aba WhatsApp */}
          <TabsContent value="whatsapp" className="space-y-6">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle>Configuração WhatsApp</CardTitle>
                <CardDescription>Integre sua conta WhatsApp Business</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoadingConfig ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : (
                  <>
                    {/* Status da Conexão */}
                    {whatsappConfig && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="font-medium text-green-900">Conectado</span>
                        </div>
                        <p className="text-sm text-green-800">
                          Número: <strong>{whatsappConfig.phoneNumber}</strong>
                        </p>
                      </div>
                    )}

                    {/* Phone Number ID */}
                    <div className="space-y-2">
                      <Label htmlFor="phoneNumberId" className="text-slate-700 font-medium">
                        Phone Number ID
                      </Label>
                      <Input
                        id="phoneNumberId"
                        placeholder="123456789"
                        value={formData.phoneNumberId}
                        onChange={(e) =>
                          setFormData({ ...formData, phoneNumberId: e.target.value })
                        }
                        className="border border-slate-300"
                      />
                    </div>

                    {/* Business Account ID */}
                    <div className="space-y-2">
                      <Label htmlFor="businessAccountId" className="text-slate-700 font-medium">
                        Business Account ID
                      </Label>
                      <Input
                        id="businessAccountId"
                        placeholder="987654321"
                        value={formData.businessAccountId}
                        onChange={(e) =>
                          setFormData({ ...formData, businessAccountId: e.target.value })
                        }
                        className="border border-slate-300"
                      />
                    </div>

                    {/* Access Token */}
                    <div className="space-y-2">
                      <Label htmlFor="accessToken" className="text-slate-700 font-medium">
                        Access Token
                      </Label>
                      <div className="relative">
                        <Input
                          id="accessToken"
                          type={showAccessToken ? "text" : "password"}
                          placeholder="Seu token de acesso"
                          value={formData.accessToken}
                          onChange={(e) =>
                            setFormData({ ...formData, accessToken: e.target.value })
                          }
                          className="border border-slate-300 pr-10"
                        />
                        <button
                          onClick={() => setShowAccessToken(!showAccessToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                        >
                          {showAccessToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Webhook Verify Token */}
                    <div className="space-y-2">
                      <Label htmlFor="webhookVerifyToken" className="text-slate-700 font-medium">
                        Webhook Verify Token
                      </Label>
                      <div className="relative">
                        <Input
                          id="webhookVerifyToken"
                          type={showWebhookToken ? "text" : "password"}
                          placeholder="Token para validar webhooks"
                          value={formData.webhookVerifyToken}
                          onChange={(e) =>
                            setFormData({ ...formData, webhookVerifyToken: e.target.value })
                          }
                          className="border border-slate-300 pr-10"
                        />
                        <button
                          onClick={() => setShowWebhookToken(!showWebhookToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                        >
                          {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-2">
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
                    </div>

                    {/* Webhook URL */}
                    <div className="space-y-2">
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
                    </div>

                    {/* Botões de Ação */}
                    <div className="flex gap-3">
                      <Button
                        onClick={handleSaveWhatsApp}
                        disabled={saveConfigMutation.isPending}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
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
