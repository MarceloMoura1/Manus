import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MessageSquare, Check, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AdminSettingsPageProps {
  clientId: string;
}

export function AdminSettingsPage({ clientId }: AdminSettingsPageProps) {
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Fetch WhatsApp config
  const { data: whatsappConfig, isLoading: isLoadingConfig, refetch: refetchConfig } = trpc.whatsapp.getConfig.useQuery(
    { clientId },
    { enabled: !!clientId }
  );

  // Mutations
  const saveConfigMutation = trpc.whatsapp.saveConfig.useMutation();
  const testConnectionMutation = trpc.whatsapp.testConnection.useMutation();

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

  const handleSaveConfig = async () => {
    if (!formData.phoneNumberId || !formData.businessAccountId || !formData.accessToken || !formData.webhookVerifyToken) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      await saveConfigMutation.mutateAsync({
        clientId,
        phoneNumberId: formData.phoneNumberId,
        businessAccountId: formData.businessAccountId,
        accessToken: formData.accessToken,
        webhookVerifyToken: formData.webhookVerifyToken,
        phoneNumber: formData.phoneNumber,
        webhookUrl: formData.webhookUrl,
      });

      toast.success("Configuração salva com sucesso!");
      refetchConfig();
      setFormData((prev) => ({ ...prev, accessToken: "" }));
    } catch (error) {
      toast.error("Erro ao salvar configuração: " + (error instanceof Error ? error.message : ""));
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const result = await testConnectionMutation.mutateAsync({ clientId });
      if (result.success) {
        toast.success(result.message);
        refetchConfig();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error("Erro ao testar conexão: " + (error instanceof Error ? error.message : ""));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <Tabs defaultValue="whatsapp" className="w-full">
        <TabsList className="grid w-full grid-cols-5 bg-slate-100">
          <TabsTrigger value="whatsapp" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="general" disabled>
            Geral
          </TabsTrigger>
          <TabsTrigger value="tickets" disabled>
            Chamados
          </TabsTrigger>
          <TabsTrigger value="team" disabled>
            Equipe
          </TabsTrigger>
          <TabsTrigger value="backup" disabled>
            Backup
          </TabsTrigger>
        </TabsList>

        {/* Aba WhatsApp */}
        <TabsContent value="whatsapp" className="space-y-6">
          {isLoadingConfig ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <>
              {/* Status Card */}
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-500" />
                    Status da Conexão
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    {/* Número Conectado */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-sm text-muted-foreground mb-2">Número Conectado</p>
                      <p className="font-semibold text-foreground">
                        {whatsappConfig?.phoneNumber || "Não configurado"}
                      </p>
                    </div>

                    {/* Status Conexão */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-sm text-muted-foreground mb-2">Status Conexão</p>
                      <div className="flex items-center gap-2">
                        {whatsappConfig?.isConnected ? (
                          <>
                            <Check className="w-5 h-5 text-green-500" />
                            <span className="font-semibold text-green-600">Conectado</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-5 h-5 text-red-500" />
                            <span className="font-semibold text-red-600">Desconectado</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Webhook Status */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-sm text-muted-foreground mb-2">Webhook Status</p>
                      <div className="flex items-center gap-2">
                        {whatsappConfig?.webhookStatus === "verified" ? (
                          <>
                            <Check className="w-5 h-5 text-green-500" />
                            <span className="font-semibold text-green-600">Verificado</span>
                          </>
                        ) : whatsappConfig?.webhookStatus === "failed" ? (
                          <>
                            <AlertCircle className="w-5 h-5 text-red-500" />
                            <span className="font-semibold text-red-600">Falha</span>
                          </>
                        ) : (
                          <>
                            <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
                            <span className="font-semibold text-yellow-600">Pendente</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Configuração Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Configuração WhatsApp Business</CardTitle>
                  <CardDescription>
                    Configure suas credenciais da API WhatsApp Business para integrar a plataforma
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Phone Number ID */}
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
                    <Input
                      id="phoneNumberId"
                      placeholder="Ex: 123456789012345"
                      value={formData.phoneNumberId}
                      onChange={(e) => setFormData({ ...formData, phoneNumberId: e.target.value })}
                      className="border-slate-200"
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontre em: Meta for Developers → App → WhatsApp → Phone Numbers
                    </p>
                  </div>

                  {/* Business Account ID */}
                  <div className="space-y-2">
                    <Label htmlFor="businessAccountId">Business Account ID *</Label>
                    <Input
                      id="businessAccountId"
                      placeholder="Ex: 123456789012345"
                      value={formData.businessAccountId}
                      onChange={(e) => setFormData({ ...formData, businessAccountId: e.target.value })}
                      className="border-slate-200"
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontre em: Meta for Developers → App → Settings → Business Account
                    </p>
                  </div>

                  {/* Access Token */}
                  <div className="space-y-2">
                    <Label htmlFor="accessToken">Access Token *</Label>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Input
                          id="accessToken"
                          type={showAccessToken ? "text" : "password"}
                          placeholder="Ex: EAABs..."
                          value={formData.accessToken}
                          onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                          className="border-slate-200 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAccessToken(!showAccessToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showAccessToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Gere em: Meta for Developers → App → Settings → System User
                    </p>
                  </div>

                  {/* Webhook Verify Token */}
                  <div className="space-y-2">
                    <Label htmlFor="webhookVerifyToken">Webhook Verify Token *</Label>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Input
                          id="webhookVerifyToken"
                          type={showWebhookToken ? "text" : "password"}
                          placeholder="Ex: seu_token_secreto"
                          value={formData.webhookVerifyToken}
                          onChange={(e) => setFormData({ ...formData, webhookVerifyToken: e.target.value })}
                          className="border-slate-200 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowWebhookToken(!showWebhookToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Crie um token seguro para validar webhooks
                    </p>
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber">Número de Telefone</Label>
                    <Input
                      id="phoneNumber"
                      placeholder="Ex: +55 11 99999-9999"
                      value={formData.phoneNumber}
                      onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                      className="border-slate-200"
                    />
                  </div>

                  {/* Webhook URL */}
                  <div className="space-y-2">
                    <Label htmlFor="webhookUrl">Webhook URL</Label>
                    <Input
                      id="webhookUrl"
                      placeholder="Ex: https://seu-dominio.com/api/webhooks/whatsapp"
                      value={formData.webhookUrl}
                      onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                      className="border-slate-200"
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      URL automática para receber mensagens do WhatsApp
                    </p>
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3 pt-4">
                    <Button
                      onClick={handleSaveConfig}
                      disabled={saveConfigMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {saveConfigMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        "Salvar Configuração"
                      )}
                    </Button>
                    <Button
                      onClick={handleTestConnection}
                      disabled={isTesting || !whatsappConfig}
                      variant="outline"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Testando...
                        </>
                      ) : (
                        "Testar Conexão"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
