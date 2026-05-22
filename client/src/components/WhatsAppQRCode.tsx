import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, RefreshCw, X, Smartphone, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface WhatsAppQRCodeProps {
  clientId: string;
  onNeedClientId?: () => Promise<void>;
}

export function WhatsAppQRCode({ clientId, onNeedClientId }: WhatsAppQRCodeProps) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'loading' | 'qr_ready' | 'connected'>('disconnected');

  // Buscar QR Code
  const fetchQRCode = useCallback(async () => {
    console.log('[WhatsAppQRCode] fetchQRCode called with clientId:', clientId);
    if (!clientId) {
      console.warn('[WhatsAppQRCode] clientId is empty, calling onNeedClientId');
      if (onNeedClientId) {
        await onNeedClientId();
      }
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/whatsapp/qrcode?clientId=${encodeURIComponent(clientId)}`);
      const data = await response.json();

      if (data.connected) {
        setConnected(true);
        setPhoneNumber(data.phoneNumber);
        setStatus('connected');
        setQrCode(null);
      } else if (data.qrcode) {
        setConnected(false);
        setStatus('qr_ready');
        setQrCode(data.qrcode);
        toast.success('QR Code gerado! Escaneie com seu WhatsApp');
      } else if (data.error) {
        toast.error(data.error);
        setStatus('disconnected');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao buscar QR Code');
      setStatus('disconnected');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // Verificar status ao carregar
  useEffect(() => {
    console.log('[WhatsAppQRCode] useEffect called with clientId:', clientId);
    const checkStatus = async () => {
      if (!clientId) {
        console.warn('[WhatsAppQRCode] clientId is empty in useEffect!');
        return;
      }

      try {
        const response = await fetch(`/api/whatsapp/status?clientId=${encodeURIComponent(clientId)}`);
        const data = await response.json();

        if (data.connected) {
          setConnected(true);
          setPhoneNumber(data.phoneNumber);
          setStatus('connected');
          setQrCode(null);
        } else {
          setConnected(false);
          setStatus('disconnected');
          // Buscar QR Code se não estiver conectado
          await fetchQRCode();
        }
      } catch (err) {
        console.error('Erro ao verificar status:', err);
      }
    };

    checkStatus();
  }, [clientId, fetchQRCode]);

  // Desconectar WhatsApp
  const handleDisconnect = async () => {
    if (!clientId) return;

    try {
      setLoading(true);
      const response = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });

      const data = await response.json();

      if (data.ok) {
        setConnected(false);
        setPhoneNumber(null);
        setStatus('disconnected');
        setQrCode(null);
        toast.success('WhatsApp desconectado com sucesso');
        
        // Buscar novo QR Code
        await fetchQRCode();
      } else {
        toast.error(data.error || 'Erro ao desconectar');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao desconectar');
    } finally {
      setLoading(false);
    }
  };

  // Atualizar QR Code
  const handleRefreshQR = async () => {
    if (!clientId) return;

    try {
      setLoading(true);
      setStatus('loading');
      const response = await fetch('/api/whatsapp/refresh-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });

      const data = await response.json();

      if (data.qrcode) {
        setQrCode(data.qrcode);
        setStatus('qr_ready');
        toast.success('Novo QR Code gerado!');
      } else if (data.error) {
        toast.error(data.error);
        setStatus('disconnected');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar QR Code');
      setStatus('disconnected');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className={`border-2 transition-all ${
        connected 
          ? 'bg-green-50 border-green-200' 
          : status === 'qr_ready'
          ? 'bg-blue-50 border-blue-200'
          : 'bg-slate-50 border-slate-200'
      }`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                connected ? 'bg-green-500' : 'bg-slate-400'
              }`}>
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Conectar WhatsApp</CardTitle>
                <CardDescription>
                  {connected 
                    ? 'WhatsApp conectado e pronto para usar'
                    : 'Escaneie o QR Code com seu WhatsApp'}
                </CardDescription>
              </div>
            </div>
            <Badge className={`${
              connected
                ? 'bg-green-100 text-green-700 border-green-200'
                : status === 'qr_ready'
                ? 'bg-blue-100 text-blue-700 border-blue-200'
                : status === 'loading'
                ? 'bg-amber-100 text-amber-700 border-amber-200'
                : 'bg-red-100 text-red-700 border-red-200'
            }`}>
              {status === 'loading' && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Gerando...
                </>
              )}
              {status === 'qr_ready' && (
                <>
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Aguardando leitura
                </>
              )}
              {status === 'connected' && (
                <>
                  <span className="w-2 h-2 bg-green-600 rounded-full mr-1" />
                  Conectado
                </>
              )}
              {status === 'disconnected' && (
                <>
                  <X className="w-3 h-3 mr-1" />
                  Desconectado
                </>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Estado: Conectado */}
          {connected && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-green-100 rounded-xl border border-green-200">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-sm">✓</span>
                </div>
                <div>
                  <p className="font-semibold text-green-900">WhatsApp conectado com sucesso!</p>
                  {phoneNumber && (
                    <p className="text-sm text-green-800">Número: {phoneNumber}</p>
                  )}
                </div>
              </div>
              <Button
                onClick={handleDisconnect}
                disabled={loading}
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Desconectando...
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Desconectar WhatsApp
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Estado: QR Code Pronto */}
          {status === 'qr_ready' && qrCode && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-xl border-2 border-dashed border-slate-300">
                <img
                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64 rounded-lg shadow-md"
                />
                <div className="text-center">
                  <p className="font-semibold text-slate-900">Escaneie com o WhatsApp do seu celular</p>
                  <p className="text-sm text-slate-600 mt-2">
                    Abra o WhatsApp → Dispositivos Vinculados → Vincular um dispositivo
                  </p>
                </div>
              </div>
              <Button
                onClick={handleRefreshQR}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Gerando novo...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Gerar novo QR Code
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Estado: Gerando QR Code */}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <div className="text-center">
                <p className="font-semibold text-slate-900">Gerando QR Code...</p>
                <p className="text-sm text-slate-600 mt-1">Aguarde alguns segundos</p>
              </div>
            </div>
          )}

          {/* Estado: Desconectado */}
          {status === 'disconnected' && !qrCode && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
                <Smartphone className="w-10 h-10 text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-900">WhatsApp não conectado</p>
                <p className="text-sm text-slate-600 mt-1">Clique abaixo para gerar um QR Code</p>
              </div>
              <Button
                onClick={fetchQRCode}
                disabled={loading}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Conectar WhatsApp
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aviso de Segurança */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-5 pb-5">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold mb-1">Importante</p>
              <p>O celular precisa estar com internet ativa. O QR Code expira em 60 segundos — se não conseguir escanear a tempo, clique em "Gerar novo QR Code".</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
