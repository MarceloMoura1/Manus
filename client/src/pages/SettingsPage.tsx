import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { formatDate } from '@/lib/conversationDateTime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Tabs removidos: layout agora usa lista lateral com condicionais
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Trash2, Plus, Edit2, Lock, Bell, MessageSquare, Wifi, Check, AlertCircle, Loader2,
  Building2, Phone, Mail, MapPin, Clock, Image, Users, Shield, Key, UserPlus,
  UserX, Download, Upload, Database, RefreshCw, Settings2, Tag, Palette, ChevronRight,
  Eye, EyeOff, Save, X, AlertTriangle, CheckCircle2, Info, Bot
} from 'lucide-react';
import { toast } from 'sonner';
import { UserPersonalizationTab } from '@/components/UserPersonalizationTab';
import { BotConfigPage } from './BotConfigPage';
import { TeamTab } from './settings/TeamTab';

// ─── Session helper ──────────────────────────────────────────────────────────
const MEGADESK_SESSION_KEY = 'megadesk_session_v1';
function getMegaDeskSession() {
  try {
    const raw = localStorage.getItem(MEGADESK_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      clientId: string;
      userRole: 'admin' | 'manager' | 'agent' | 'viewer';
      userEmail: string;
      userName: string;
      company: string;
      plan: string;
    };
  } catch { return null; }
}

// ─── Permissões disponíveis ──────────────────────────────────────────────────
const AVAILABLE_PERMISSIONS = [
  { key: 'active-attendance', label: 'Atendimento Ativo', icon: MessageSquare, color: 'text-blue-600' },
  { key: 'conversations', label: 'Conversas', icon: MessageSquare, color: 'text-green-600' },
  { key: 'tickets', label: 'Chamados', icon: Bell, color: 'text-orange-600' },
  { key: 'tracking', label: 'Rastreamento', icon: MapPin, color: 'text-purple-600' },
  { key: 'erp', label: 'ERP', icon: Database, color: 'text-red-600' },
  { key: 'clients', label: 'Clientes', icon: Users, color: 'text-teal-600' },
  { key: 'bot-config', label: 'Configurar Bot', icon: Settings2, color: 'text-indigo-600' },
  { key: 'ai-assistant', label: 'Assistente IA', icon: Wifi, color: 'text-pink-600' },
];

// ─── Role labels ─────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  agent: 'Atendente',
  viewer: 'Visualizador',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  manager: 'bg-purple-100 text-purple-700 border-purple-200',
  agent: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer: 'bg-gray-100 text-gray-700 border-gray-200',
};

// ─── Color presets para status ────────────────────────────────────────────────
const STATUS_COLOR_PRESETS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6b7280',
];

// ─── Componente: Switch bonito com verde/vermelho ─────────────────────────────
function StatusSwitch({ checked, onCheckedChange, label, description, icon: Icon }: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  description?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className={`p-4 rounded-xl border-2 transition-all duration-300 ${
      checked ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-300 shadow-md shadow-green-100' : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-300 shadow-md shadow-red-100'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          {Icon && (
            <div className={`p-2.5 rounded-lg transition-all duration-300 ${
              checked ? 'bg-gradient-to-br from-green-100 to-emerald-100 scale-110' : 'bg-gradient-to-br from-red-100 to-rose-100'
            }`}>
              <Icon className={`w-5 h-5 transition-colors duration-300 ${
                checked ? 'text-green-600' : 'text-red-600'
              }`} />
            </div>
          )}
          <div>
            <p className="font-semibold text-slate-900 text-sm">{label}</p>
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
        </div>
        <button
          onClick={() => onCheckedChange(!checked)}
          className={`relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-300 flex-shrink-0 ml-4 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            checked ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-lg shadow-green-400/50 focus:ring-green-400' : 'bg-gradient-to-r from-red-500 to-rose-500 shadow-lg shadow-red-400/50 focus:ring-red-400'
          }`}
        >
          <span
            className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-all duration-300 ${
              checked ? 'translate-x-9' : 'translate-x-1'
            }`}
          />
          <span className="absolute left-1.5 flex h-6 w-6 items-center justify-center text-xs font-bold text-red-600 transition-opacity duration-300" style={{ opacity: checked ? 0 : 1 }}>
            ✕
          </span>
          <span className="absolute right-1.5 flex h-6 w-6 items-center justify-center text-xs font-bold text-green-600 transition-opacity duration-300" style={{ opacity: checked ? 1 : 0 }}>
            ✓
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Componente: Banner de acesso restrito ────────────────────────────────────
function AdminOnlyBanner() {
  return (
    <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
      <Shield className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <div>
        <p className="text-sm font-semibold text-amber-800">Acesso restrito a Administradores</p>
        <p className="text-xs text-amber-600 mt-0.5">Esta seção só está disponível para usuários com cargo de Administrador.</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA GERAL
// ════════════════════════════════════════════════════════════════════════════
function TabGeral({ clientId, userRole }: { clientId: string; userRole: string }) {
  const isAdmin = userRole === 'admin';
  const [form, setForm] = useState({
    companyName: '', logoUrl: '', email: '', phone: '',
    whatsapp: '', address: '', businessHours: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: settings, isLoading } = trpc.megadeskSettings.getCompanySettings.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  useEffect(() => {
    if (settings) {
      setForm({
        companyName: settings.companyName ?? '',
        logoUrl: settings.logoUrl ?? '',
        email: settings.email ?? '',
        phone: settings.phone ?? '',
        whatsapp: settings.whatsapp ?? '',
        address: settings.address ?? '',
        businessHours: settings.businessHours ?? '',
      });
    }
  }, [settings]);

  const saveMutation = trpc.megadeskSettings.saveCompanySettings.useMutation({
    onSuccess: () => { toast.success('Configurações salvas com sucesso!'); setSaving(false); },
    onError: (err) => { toast.error(err.message); setSaving(false); },
  });

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate({ clientId, userRole, ...form });
  };

  if (!isAdmin) return (
    <div className="space-y-4">
      <AdminOnlyBanner />
      <Card className="border-slate-200"><CardContent className="pt-6 text-center text-slate-500 py-12">
        <Lock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p className="font-medium">Sem permissão de acesso</p>
        <p className="text-sm mt-1">Solicite ao administrador que conceda acesso a esta seção.</p>
      </CardContent></Card>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <Building2 className="w-5 h-5 text-blue-600" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Dados da Empresa</p>
          <p className="text-xs text-blue-600">Configure as informações básicas da sua empresa na plataforma.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Nome da empresa */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-500" /> Nome da Empresa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Ex: Minha Empresa Ltda"
                value={form.companyName}
                onChange={(e) => setForm(p => ({ ...p, companyName: e.target.value }))}
              />
            </CardContent>
          </Card>

          {/* E-mail */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="w-4 h-4 text-green-500" /> E-mail Principal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="email"
                placeholder="contato@empresa.com"
                value={form.email}
                onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
              />
            </CardContent>
          </Card>

          {/* Telefone */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="w-4 h-4 text-purple-500" /> Telefone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="+55 41 3333-3333"
                value={form.phone}
                onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))}
              />
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-green-600" /> WhatsApp Principal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="+55 41 99999-9999"
                value={form.whatsapp}
                onChange={(e) => setForm(p => ({ ...p, whatsapp: e.target.value }))}
              />
            </CardContent>
          </Card>

          {/* Endereço */}
          <Card className="bg-white border-slate-200 shadow-sm md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500" /> Endereço
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Rua, número, bairro, cidade - UF"
                value={form.address}
                onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))}
              />
            </CardContent>
          </Card>

          {/* Horário de funcionamento */}
          <Card className="bg-white border-slate-200 shadow-sm md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> Horário de Funcionamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Ex: Segunda a Sexta, 08h às 18h"
                value={form.businessHours}
                onChange={(e) => setForm(p => ({ ...p, businessHours: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-2">Informe o horário de atendimento da sua empresa.</p>
            </CardContent>
          </Card>

          {/* Logo URL */}
          <Card className="bg-white border-slate-200 shadow-sm md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Image className="w-4 h-4 text-indigo-500" /> URL do Logotipo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                placeholder="https://exemplo.com/logo.png"
                value={form.logoUrl}
                onChange={(e) => setForm(p => ({ ...p, logoUrl: e.target.value }))}
              />
              {form.logoUrl && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <img
                    src={form.logoUrl}
                    alt="Logo preview"
                    className="w-12 h-12 object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <p className="text-xs text-slate-500">Pré-visualização do logotipo</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configurações
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA CHAMADOS (Status personalizados)
// ════════════════════════════════════════════════════════════════════════════
function TabChamados({ clientId, userRole }: { clientId: string; userRole: string }) {
  const isAdmin = userRole === 'admin';
  const [showCreate, setShowCreate] = useState(false);
  const [editingStatus, setEditingStatus] = useState<{ statusId: string; name: string; color: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const utils = trpc.useUtils();

  const { data: statuses = [], isLoading } = trpc.megadeskSettings.listTicketStatuses.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  const createMutation = trpc.megadeskSettings.createTicketStatus.useMutation({
    onSuccess: () => {
      toast.success('Status criado com sucesso!');
      utils.megadeskSettings.listTicketStatuses.invalidate();
      setShowCreate(false);
      setNewName('');
      setNewColor('#3b82f6');
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.megadeskSettings.updateTicketStatus.useMutation({
    onSuccess: () => {
      toast.success('Status atualizado!');
      utils.megadeskSettings.listTicketStatuses.invalidate();
      setEditingStatus(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.megadeskSettings.deleteTicketStatus.useMutation({
    onSuccess: () => {
      toast.success('Status removido!');
      utils.megadeskSettings.listTicketStatuses.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAdmin) return (
    <div className="space-y-4">
      <AdminOnlyBanner />
      <Card className="border-slate-200"><CardContent className="pt-6 text-center text-slate-500 py-12">
        <Lock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p className="font-medium">Sem permissão de acesso</p>
      </CardContent></Card>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header informativo */}
      <div className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-xl">
        <Tag className="w-5 h-5 text-orange-600" />
        <div>
          <p className="text-sm font-semibold text-orange-800">Status Personalizados de Chamados</p>
          <p className="text-xs text-orange-600">Crie status customizados que aparecerão como cards na página de Chamados, com filtros funcionais.</p>
        </div>
      </div>

      {/* Botão criar */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-slate-800">Status Configurados</h3>
          <p className="text-xs text-slate-500">{statuses.length} status(es) cadastrado(s)</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Status
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      ) : statuses.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="pt-6 text-center py-12">
            <Tag className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-600">Nenhum status personalizado</p>
            <p className="text-sm text-slate-400 mt-1">Crie status como "Aguardando Cliente", "Em Análise", "Urgente", etc.</p>
            <Button onClick={() => setShowCreate(true)} className="mt-4 gap-2" variant="outline">
              <Plus className="w-4 h-4" /> Criar primeiro status
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {statuses.map((status) => (
            <Card key={status.statusId} className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                      style={{ backgroundColor: status.color }}
                    />
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{status.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{status.color}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 hover:bg-blue-50"
                      onClick={() => setEditingStatus({ statusId: status.statusId, name: status.name, color: status.color })}
                    >
                      <Edit2 className="w-3 h-3 text-blue-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`Remover o status "${status.name}"?`)) {
                          deleteMutation.mutate({ clientId, userRole, statusId: status.statusId });
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                {/* Preview do badge */}
                <div className="mt-3">
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: status.color }}
                  >
                    {status.name}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Exemplos sugeridos */}
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-600 flex items-center gap-2">
            <Info className="w-4 h-4" /> Exemplos de status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { name: 'Aguardando Cliente', color: '#f59e0b' },
              { name: 'Em Análise', color: '#3b82f6' },
              { name: 'Urgente', color: '#ef4444' },
              { name: 'Finalizado', color: '#10b981' },
              { name: 'Em Espera', color: '#8b5cf6' },
            ].map((ex) => (
              <button
                key={ex.name}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: ex.color }}
                onClick={() => { setNewName(ex.name); setNewColor(ex.color); setShowCreate(true); }}
              >
                {ex.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">Clique para usar como base para um novo status.</p>
        </CardContent>
      </Card>

      {/* Dialog: Criar status */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md bg-white border-2 border-black">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-orange-500" /> Novo Status de Chamado
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Status</label>
              <Input
                placeholder="Ex: Aguardando Cliente"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cor</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-slate-200"
                />
                <Input
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="font-mono text-sm"
                  maxLength={7}
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {STATUS_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: newColor === c ? '#1e293b' : 'transparent' }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
            </div>
            {/* Preview */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-500 mb-2">Pré-visualização:</p>
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: newColor }}
              >
                {newName || 'Nome do Status'}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!newName.trim()) { toast.error('Informe o nome do status.'); return; }
                createMutation.mutate({ clientId, userRole, name: newName.trim(), color: newColor });
              }}
              disabled={createMutation.isPending}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar status */}
      <Dialog open={!!editingStatus} onOpenChange={() => setEditingStatus(null)}>
        <DialogContent className="sm:max-w-md bg-white border-2 border-black">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-blue-500" /> Editar Status
            </DialogTitle>
          </DialogHeader>
          {editingStatus && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome do Status</label>
                <Input
                  value={editingStatus.name}
                  onChange={(e) => setEditingStatus(p => p ? { ...p, name: e.target.value } : null)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cor</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={editingStatus.color}
                    onChange={(e) => setEditingStatus(p => p ? { ...p, color: e.target.value } : null)}
                    className="w-10 h-10 rounded cursor-pointer border border-slate-200"
                  />
                  <Input
                    value={editingStatus.color}
                    onChange={(e) => setEditingStatus(p => p ? { ...p, color: e.target.value } : null)}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {STATUS_COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: c, borderColor: editingStatus.color === c ? '#1e293b' : 'transparent' }}
                      onClick={() => setEditingStatus(p => p ? { ...p, color: c } : null)}
                    />
                  ))}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-2">Pré-visualização:</p>
                <span
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: editingStatus.color }}
                >
                  {editingStatus.name || 'Nome do Status'}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStatus(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!editingStatus) return;
                updateMutation.mutate({
                  clientId, userRole,
                  statusId: editingStatus.statusId,
                  name: editingStatus.name,
                  color: editingStatus.color,
                });
              }}
              disabled={updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA EQUIPE
// ════════════════════════════════════════════════════════════════════════════
function TabEquipe({ clientId, userRole }: { clientId: string; userRole: string }) {
  return <TeamTab clientId={clientId} userRole={userRole} />;
}

// ════════════════════════════════════════════════════════════════════════════
// ABA BACKUP
// ════════════════════════════════════════════════════════════════════════════
function TabBackup({ clientId, userRole }: { clientId: string; userRole: string }) {
  const isAdmin = userRole === 'admin';
  const [exporting, setExporting] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    includeConversations: true,
    includeChamados: true,
    includeCustomers: true,
    includeBotScripts: true,
  });

  const { data: stats, isLoading: statsLoading } = trpc.megadeskSettings.getDataStats.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  const exportMutation = trpc.megadeskSettings.exportClientData.useMutation({
    onSuccess: (result) => {
      // Baixar o JSON exportado
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `megadesk-backup-${clientId}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Backup exportado com sucesso!');
      setExporting(false);
    },
    onError: (err) => { toast.error(err.message); setExporting(false); },
  });

  const handleExport = () => {
    setExporting(true);
    exportMutation.mutate({ clientId, userRole, ...exportOptions });
  };

  if (!isAdmin) return (
    <div className="space-y-4">
      <AdminOnlyBanner />
      <Card className="border-slate-200"><CardContent className="pt-6 text-center text-slate-500 py-12">
        <Lock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p className="font-medium">Sem permissão de acesso</p>
      </CardContent></Card>
    </div>
  );

  const statItems = [
    { label: 'Clientes', value: stats?.customers ?? 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Chamados', value: stats?.chamados ?? 0, icon: Bell, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Conversas', value: stats?.conversations ?? 0, icon: MessageSquare, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Scripts Bot', value: stats?.botScripts ?? 0, icon: Settings2, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'CRM', value: stats?.crmClients ?? 0, icon: Database, color: 'text-teal-600', bg: 'bg-teal-50' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-teal-50 border border-teal-200 rounded-xl">
        <Database className="w-5 h-5 text-teal-600" />
        <div>
          <p className="text-sm font-semibold text-teal-800">Backup e Exportação de Dados</p>
          <p className="text-xs text-teal-600">Exporte seus dados em formato JSON para backup ou migração.</p>
        </div>
      </div>

      {/* Estatísticas de dados */}
      <div>
        <h3 className="font-semibold text-slate-800 mb-3">Resumo dos Dados</h3>
        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {statItems.map((item) => (
              <Card key={item.label} className="bg-white border-slate-200 shadow-sm">
                <CardContent className="pt-4 pb-4">
                  <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center mb-2`}>
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{item.value.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{item.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Exportação de dados */}
        <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-5 h-5 text-teal-600" /> Exportar Dados
          </CardTitle>
          <CardDescription>Selecione quais dados deseja incluir no backup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'includeCustomers', label: 'Clientes / Contatos', icon: Users, count: stats?.customers },
              { key: 'includeChamados', label: 'Chamados', icon: Bell, count: stats?.chamados },
              { key: 'includeConversations', label: 'Conversas', icon: MessageSquare, count: stats?.conversations },
              { key: 'includeBotScripts', label: 'Scripts do Bot', icon: Settings2, count: stats?.botScripts },
            ].map((item) => {
              const checked = exportOptions[item.key as keyof typeof exportOptions];
              return (
                <label
                  key={item.key}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    checked ? 'bg-teal-50 border-teal-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => setExportOptions(p => ({ ...p, [item.key]: !!v }))}
                  />
                  <div className="flex items-center gap-2 flex-1">
                    <item.icon className={`w-4 h-4 ${checked ? 'text-teal-600' : 'text-slate-400'}`} />
                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  </div>
                  {item.count !== undefined && (
                    <span className="text-xs text-slate-400">{item.count} registros</span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="text-xs text-slate-500">
              Formato: JSON • Exportado em: {formatDate(new Date())}
            </div>
            <Button
              onClick={handleExport}
              disabled={exporting || !Object.values(exportOptions).some(Boolean)}
              className="bg-teal-600 hover:bg-teal-700 text-white gap-2"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Exportar Backup
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Informações sobre backup automático */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Backup Automático</p>
              <p className="text-xs text-amber-700 mt-1">
                O sistema realiza backups automáticos diários dos dados. Para restaurar um backup anterior,
                entre em contato com o suporte do MegaAdmin.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: SettingsPage
// ════════════════════════════════════════════════════════════════════════════
type SettingsPageProps = {
  layout?: "standalone" | "workspace";
};

export function SettingsPage({ layout = "standalone" }: SettingsPageProps) {
  const { user } = useAuth();
  const session = getMegaDeskSession();
  const clientId = session?.clientId ?? '';
  const userRole = session?.userRole ?? 'viewer';
  const isAdmin = userRole === 'admin';
  const isWorkspace = layout === "workspace";

  // ─── Normalização e Lista Estrita de Abas com RBAC ─────────────────────────
  const resolveTabAlias = (rawTab: string | null): string | null => {
    if (!rawTab) return null;
    const t = rawTab.toLowerCase().trim();
    if (t === 'bot' || t === 'bot-config' || t === 'configurar-bot') return 'bot-config';
    if (t === 'users' || t === 'equipe' || t === 'team') return 'equipe';
    if (t === 'whats' || t === 'whatsapp') return 'whatsapp';
    if (t === 'notificacoes' || t === 'notifications') return 'notifications';
    if (t === 'atendimento' || t === 'attendance') return 'attendance';
    if (t === 'personalizacao' || t === 'personalization') return 'personalization';
    if (t === 'geral' || t === 'empresa') return 'geral';
    if (t === 'chamados' || t === 'tickets') return 'chamados';
    if (t === 'backup') return 'backup';
    return t;
  };

  const getInitialTab = (): string => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = resolveTabAlias(params.get('tab'));
      if (tabParam) {
        const adminValues = ['whatsapp', 'geral', 'chamados', 'equipe', 'backup', 'bot-config'];
        if (adminValues.includes(tabParam) && !isAdmin) {
          return 'notifications';
        }
        return tabParam;
      }
    }
    return isAdmin ? 'whatsapp' : 'notifications';
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Proteção contra acesso indevido por URL ou alteração externa
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = resolveTabAlias(params.get('tab'));
    const adminTabsList = ['whatsapp', 'geral', 'chamados', 'equipe', 'backup', 'bot-config'];

    if (tabParam) {
      if (adminTabsList.includes(tabParam) && !isAdmin) {
        setActiveTab('notifications');
        params.set('tab', 'notifications');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        toast.error('Acesso restrito a administradores. Redirecionado para Notificações.');
        return;
      }
      if (tabParam !== activeTab) {
        setActiveTab(tabParam);
      }
      return;
    }

    if (adminTabsList.includes(activeTab) && !isAdmin) {
      setActiveTab('notifications');
      params.set('tab', 'notifications');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, [isAdmin, activeTab]);

  const handleSelectTab = (tabValue: string) => {
    const adminTabsList = ['whatsapp', 'geral', 'chamados', 'equipe', 'backup', 'bot-config'];
    if (adminTabsList.includes(tabValue) && !isAdmin) {
      setActiveTab('notifications');
      toast.error('Acesso restrito a administradores.');
      return;
    }
    setActiveTab(tabValue);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', tabValue);
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  };

  // ─── Aba: WhatsApp ────────────────────────────────────────────────────────
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [webhookStatus, setWebhookStatus] = useState<'active' | 'inactive' | 'testing'>('inactive');
  const [credentialsStatus, setCredentialsStatus] = useState<'valid' | 'invalid' | 'checking'>('invalid');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);

  // ─── QR Code Evolution API ──────────────────────────────────────────────────────
  type EvolutionStatus = 'disconnected' | 'connecting' | 'connected';
  const [evolutionStatus, setEvolutionStatus] = useState<EvolutionStatus>('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [evolutionPhone, setEvolutionPhone] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);

  // ─── tRPC: Conexão (cria instância + retorna QR) ──────────────────────────
  const connectMut = trpc.evolution.connect.useMutation({
    onSuccess: (data) => {
      setIsStartingSession(false);
      if (data.qrCode) {
        setQrDataUrl(data.qrCode);
        setEvolutionStatus('connecting');
        toast.success('QR Code gerado! Escaneie com seu WhatsApp.');
      } else if (data.status === 'connected') {
        setEvolutionStatus('connected');
        setEvolutionPhone(data.phoneNumber ?? null);
        toast.success('WhatsApp já está conectado!');
      }
    },
    onError: (err) => {
      setIsStartingSession(false);
      toast.error(err.message || 'Erro ao conectar. Verifique se a Evolution API está rodando.');
    },
  });

  // ─── tRPC: Buscar QR Code atual (sem recriar instância) ───────────────────
  const getQRCodeQuery = trpc.evolution.getQRCode.useQuery(
    { clientId: clientId || '' },
    { enabled: false } // Só executa manualmente
  );

  // ─── tRPC: Desconectar ────────────────────────────────────────────────────
  const disconnectMut = trpc.evolution.disconnect.useMutation({
    onSuccess: () => {
      setEvolutionStatus('disconnected');
      setQrDataUrl(null);
      setEvolutionPhone(null);
      toast.success('WhatsApp desconectado!');
    },
    onError: (err) => {
      toast.error(err.message || 'Erro ao desconectar');
    },
  });
  const repairEvolutionMut = trpc.evolution.repair.useMutation({
    onSuccess: (data) => {
      setEvolutionStatus(data.status as EvolutionStatus);
      if (data.qrCode) setQrDataUrl(data.qrCode);
      toast.success('Integração verificada e webhook reconfigurado.');
    },
    onError: (err) => toast.error(err.message || 'Erro ao reparar integração'),
  });

  // ─── tRPC: Polling de status ──────────────────────────────────────────────
  // Polling de 3s durante 'connecting'; verificação única nos demais estados
  const getStatusQuery = trpc.evolution.getStatus.useQuery(
    { clientId: clientId || '' },
    {
      enabled: !!clientId,
      refetchInterval: evolutionStatus === 'connecting' ? 3000 : false,
      refetchOnWindowFocus: false,
    }
  );
  const evolutionHealthQuery = trpc.evolution.health.useQuery(
    { clientId: clientId || '' },
    { enabled: activeTab === 'whatsapp' && !!clientId, refetchInterval: 30_000 },
  );

  // Verificar status ao abrir a aba WhatsApp
  useEffect(() => {
    if (activeTab === 'whatsapp' && clientId) {
      getStatusQuery.refetch();
    }
  }, [activeTab, clientId]);

  // Sincronizar estado local com o que o backend retorna
  useEffect(() => {
    if (!getStatusQuery.data) return;
    const { status, phoneNumber } = getStatusQuery.data;
    setEvolutionStatus(status as EvolutionStatus);
    if (phoneNumber) setEvolutionPhone(phoneNumber);

    // Se estava em 'connecting' e QR sumiu (usuário scaneou em outro device?),
    // buscar QR atual para mostrar no UI
    if (status === 'connecting' && !qrDataUrl) {
      getQRCodeQuery.refetch().then((res) => {
        if (res.data?.qrCode) setQrDataUrl(res.data.qrCode);
      });
    }
  }, [getStatusQuery.data]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /** Cria/reconecta instância e exibe QR Code */
  const handleGenerateQr = async () => {
    if (!clientId) { toast.error('Sessão inválida'); return; }
    setIsStartingSession(true);
    setQrDataUrl(null);
    await connectMut.mutateAsync({ clientId }).catch(() => {});
    setIsStartingSession(false);
  };

  /** Busca novo QR Code sem recriar instância (para o botão "Atualizar QR") */
  const handleRefreshQr = async () => {
    if (!clientId) return;
    setIsStartingSession(true);
    const res = await getQRCodeQuery.refetch();
    if (res.data?.qrCode) {
      setQrDataUrl(res.data.qrCode);
      setEvolutionStatus('connecting');
      toast.success('QR Code atualizado!');
    } else if (res.data?.status === 'connected') {
      setEvolutionStatus('connected');
      toast.success('WhatsApp já está conectado!');
    } else {
      // Instância não existe ainda — precisa de connect
      await handleGenerateQr();
    }
    setIsStartingSession(false);
  };

  /** Desconecta o WhatsApp */
  const handleDisconnectBaileys = async () => {
    if (!clientId) return;
    if (!window.confirm('Isso fará logout do WhatsApp neste dispositivo. Para corrigir falhas, use “Reparar integração”. Deseja realmente desconectar?')) return;
    await disconnectMut.mutateAsync({ clientId, confirmation: 'DESCONECTAR' }).catch(() => {});
  };

  const validateCredentials = useCallback(() => {
    const allValid =
      /^\d{10,}$/.test(phoneNumberId) &&
      /^\d{10,}$/.test(businessAccountId) &&
      accessToken.length >= 20 &&
      webhookVerifyToken.length >= 8 &&
      /^\+?\d{10,}$/.test(phoneNumber.replace(/[\s-]/g, ''));
    setCredentialsStatus(allValid ? 'valid' : 'invalid');
    setWebhookStatus(allValid ? 'active' : 'inactive');
  }, [phoneNumberId, businessAccountId, accessToken, webhookVerifyToken, phoneNumber]);

  useEffect(() => { validateCredentials(); }, [validateCredentials]);

  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('testing');
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (credentialsStatus === 'valid') {
      setConnectionStatus('connected');
      toast.success('Conexão com WhatsApp estabelecida!');
    } else {
      setConnectionStatus('disconnected');
      toast.error('Falha ao conectar. Verifique as credenciais.');
    }
    setTestingConnection(false);
  };

  const generateSecureToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
    setWebhookVerifyToken(token);
    toast.success('Token gerado!');
  };

  // ─── Aba: Conta ───────────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(session?.userName || '');
  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // ─── Aba: Notificações ────────────────────────────────────────────────────
  const [notificationSettings, setNotificationSettings] = useState({
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

  // ─── Aba: Atendimento ─────────────────────────────────────────────────────
  const [attendanceSettings, setAttendanceSettings] = useState({
    autoReplyEnabled: false,
    autoReplyMessage: '',
    shortcuts: [] as Array<{ key: string; message: string }>,
  });
  const [newShortcutKey, setNewShortcutKey] = useState('');
  const [newShortcutMessage, setNewShortcutMessage] = useState('');

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
  };

  // ─── Helper: Status card ──────────────────────────────────────────────────
  const renderStatusCard = (title: string, status: string, description: string) => {
    const isGood = status === 'connected' || status === 'active' || status === 'valid';
    const isChecking = status === 'testing' || status === 'checking';
    return (
      <Card className={`border-2 transition-all ${isGood ? 'bg-green-50 border-green-200' : isChecking ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{title}</p>
              <p className={`text-base font-bold ${isGood ? 'text-green-700' : isChecking ? 'text-blue-700' : 'text-red-700'}`}>
                {isGood ? (status === 'connected' ? 'Conectado' : status === 'active' ? 'Ativo' : 'Válidas') :
                  isChecking ? 'Verificando...' :
                  status === 'disconnected' ? 'Desconectado' : status === 'inactive' ? 'Inativo' : 'Inválidas'}
              </p>
            </div>
            {isGood ? <Check className="w-6 h-6 text-green-600" /> :
              isChecking ? <Loader2 className="w-6 h-6 text-blue-600 animate-spin" /> :
              <AlertCircle className="w-6 h-6 text-red-600" />}
          </div>
          <p className="text-xs text-gray-500 mt-2">{description}</p>
        </CardContent>
      </Card>
    );
  };

  // ─── Tabs disponíveis ─────────────────────────────────────────────────────
  // Ordem estrita: Bloco 1 (Administradores) e Bloco 2 (Todos os usuários)
  const allTabs = [
    // [BLOCO 1: SOMENTE ADMINISTRADORES (role === 'admin')]
    { value: 'whatsapp', label: 'WhatsApp', adminOnly: true },
    { value: 'geral', label: 'Geral', adminOnly: true },
    { value: 'chamados', label: 'Chamados', adminOnly: true },
    { value: 'equipe', label: 'Equipe', adminOnly: true },
    { value: 'backup', label: 'Backup', adminOnly: true },
    { value: 'bot-config', label: 'Configurar Bot', adminOnly: true },

    // [BLOCO 2: TODOS OS USUÁRIOS]
    { value: 'notifications', label: 'Notificações', adminOnly: false },
    { value: 'attendance', label: 'Atendimento', adminOnly: false },
    { value: 'personalization', label: 'Personalização', adminOnly: false },
  ];
  // Filtrar: admin vê tudo, não-admin não vê abas adminOnly
  const tabs = allTabs.filter(tab => isAdmin || !tab.adminOnly);

  // ─── Ícones por aba ────────────────────────────────────────────────────────
  const tabIcons: Record<string, React.ElementType> = {
    whatsapp: MessageSquare,
    geral: Building2,
    chamados: Tag,
    equipe: Users,
    backup: Database,
    'bot-config': Bot,
    notifications: Bell,
    attendance: Phone,
    personalization: Palette,
  };

  const tabDescriptions: Record<string, string> = {
    whatsapp: 'Integração WhatsApp API / Instâncias',
    geral: 'Dados da empresa',
    chamados: 'Status personalizados / Regras',
    equipe: 'Usuários, papéis e permissões',
    backup: 'Exportação e restauração',
    'bot-config': 'Configuração do fluxo/regras do Bot de atendimento',
    notifications: 'Alertas e sons',
    attendance: 'Respostas rápidas e atalhos',
    personalization: 'Fundo de tela e preferências visuais',
  };

  return (
    <div
      className={isWorkspace
        ? "min-h-full bg-background px-4 py-3 sm:px-5 sm:py-4 lg:px-5 lg:py-4"
        : "min-h-screen bg-background px-4 py-4 sm:px-6 sm:py-5 lg:px-8"}
      data-layout={layout}
    >
      <div className={isWorkspace ? "w-full max-w-none" : "mx-auto w-full max-w-[1440px]"}>
        {/* Layout: lista lateral + conteúdo */}
        <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* ─── Lista lateral ─────────────────────────────────────────── */}
          <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1" data-testid="settings-navigation-shell">
            <nav className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Navegação de configurações">
              {isAdmin && (
                <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5">
                  <Shield className="size-3.5 shrink-0 text-red-600" />
                  <span className="text-xs font-medium text-red-700">Modo Administrador · Acesso completo</span>
                </div>
              )}
              <ul className="py-2">
                {tabs.map((tab, idx) => {
                  const Icon = tabIcons[tab.value] ?? Settings2;
                  const isActive = activeTab === tab.value;
                  // Separador visual entre abas admin e não-admin
                  const prevTab = tabs[idx - 1];
                  const showSeparator = idx > 0 && tab.adminOnly && !prevTab?.adminOnly;
                  return (
                    <React.Fragment key={tab.value}>
                      {showSeparator && <li className="mx-4 my-2 border-t border-slate-100" />}
                      <li>
                        <button
                          onClick={() => handleSelectTab(tab.value)}
                          className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                            isActive
                              ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-500'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                            isActive ? 'bg-blue-100' : 'bg-slate-100 group-hover:bg-slate-200'
                          }`}>
                            <Icon className={`w-5 h-5 ${
                              isActive ? 'text-blue-600' : 'text-slate-500'
                            }`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-base font-semibold leading-tight truncate ${
                              isActive ? 'text-blue-700' : 'text-slate-700'
                            }`}>{tab.label.replace(/^\p{Emoji}\s*/u, '')}</p>
                            <p className="text-xs text-slate-400 truncate mt-1">{tabDescriptions[tab.value]}</p>
                          </div>
                          {isActive && <div className="ml-auto w-1.5 h-5 bg-blue-500 rounded-full flex-shrink-0" />}
                        </button>
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>
            </nav>
          </div>

          {/* ─── Conteúdo da aba selecionada ───────────────────────────── */}
          <div className="min-w-0">

          {/* ─── Aba: WhatsApp ───────────────────────────────────────────── */}
          {activeTab === 'whatsapp' && <div className="space-y-6">

            {/* Card principal: status + QR Code */}
            <Card className="bg-white border-2 border-green-100">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">WhatsApp — Conexão via QR Code</CardTitle>
                      <CardDescription>Escaneie o QR Code com seu celular para conectar</CardDescription>
                    </div>
                  </div>
                  {/* Badge de status */}
                  {evolutionStatus === 'connected' && (
                    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Conectado
                    </Badge>
                  )}
                  {evolutionStatus === 'connecting' && (
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Conectando...
                    </Badge>
                  )}
                  {evolutionStatus === 'disconnected' && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
                      <X className="w-3 h-3" /> Desconectado
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {/* Estado: conectado */}
                {evolutionStatus === 'connected' && (
                  <div className="space-y-4">
                    {evolutionHealthQuery.data && (!evolutionHealthQuery.data.providerReachable || !evolutionHealthQuery.data.webhookHealthy) && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        <p className="font-semibold">A conexão está degradada.</p>
                        <p>{evolutionHealthQuery.data.providerReachable ? 'O webhook precisa ser reconfigurado.' : 'A Evolution API não está acessível.'}</p>
                        <Button type="button" variant="outline" size="sm" className="mt-3 border-amber-300" disabled={repairEvolutionMut.isPending} onClick={() => clientId && repairEvolutionMut.mutate({ clientId })}>
                          <RefreshCw className={`mr-2 h-4 w-4 ${repairEvolutionMut.isPending ? 'animate-spin' : ''}`} /> Reparar integração
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-4 p-4 bg-green-50 rounded-xl border border-green-200">
                      <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-green-800">WhatsApp conectado com sucesso!</p>
                        {evolutionPhone && <p className="text-sm text-green-700">Número: +{evolutionPhone}</p>}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full border-red-200 text-red-600 hover:bg-red-50"
                      onClick={handleDisconnectBaileys}
                    >
                      <X className="w-4 h-4 mr-2" />
                      Desconectar WhatsApp
                    </Button>
                  </div>
                )}

                {/* Estado: QR pronto para escanear */}
                {evolutionStatus === 'connecting' && qrDataUrl && (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-4 p-6 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                      <img src={qrDataUrl} alt="QR Code WhatsApp" className="w-64 h-64 rounded-lg shadow-md" />
                      <div className="text-center">
                        <p className="font-semibold text-slate-800">Escaneie com o WhatsApp do seu celular</p>
                        <p className="text-sm text-slate-500 mt-1">Abra o WhatsApp &rarr; Dispositivos Vinculados &rarr; Vincular um dispositivo</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleRefreshQr}
                      disabled={isStartingSession}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Atualizar QR Code
                    </Button>
                  </div>
                )}

                {/* Estado: conectando (aguardando QR) - sem QR ainda */}
                {(evolutionStatus === 'connecting' && !qrDataUrl) || isStartingSession ? (
                  <div className="flex flex-col items-center gap-4 p-8 bg-blue-50 rounded-xl border border-blue-200">
                    <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                    <div className="text-center">
                      <p className="font-semibold text-blue-800">Gerando QR Code...</p>
                      <p className="text-sm text-blue-600">Aguarde alguns segundos</p>
                    </div>
                  </div>
                ) : null}

                {/* Estado: desconectado */}
                {evolutionStatus === 'disconnected' && (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-4 p-8 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 text-slate-400" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-slate-700">WhatsApp não conectado</p>
                        <p className="text-sm text-slate-500">Clique no botão abaixo para gerar o QR Code</p>
                      </div>
                    </div>
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-base"
                      onClick={handleGenerateQr}
                      disabled={isStartingSession}
                    >
                      {isStartingSession
                        ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Iniciando...</>
                        : <><MessageSquare className="w-5 h-5 mr-2" />Gerar QR Code</>
                      }
                    </Button>
                    {/* Reparo seguro: reconfigura webhook e consulta a instância sem logout. */}
                    <Button
                      variant="outline"
                      className="w-full border-blue-200 text-blue-700 hover:bg-blue-50 text-sm"
                      disabled={repairEvolutionMut.isPending}
                      onClick={() => clientId && repairEvolutionMut.mutate({ clientId })}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${repairEvolutionMut.isPending ? 'animate-spin' : ''}`} />
                      Reparar integração sem desconectar
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Aviso sobre uso */}
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="pt-5 pb-5">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold mb-1">Importante</p>
                    <p>Esta conexão usa o WhatsApp Web. O celular precisa estar com internet ativa. O QR Code expira em 60 segundos — se não conseguir escanear a tempo, clique em "Gerar novo QR Code".</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>}

          {/* ─── Aba: Conta ──────────────────────────────────────────── */}
          {activeTab === 'account' && <div className="space-y-6">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Informações da Conta</CardTitle>
                <CardDescription>Gerencie suas informações pessoais</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nome</label>
                  {editingName ? (
                    <div className="flex gap-2">
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                      <Button onClick={() => { setEditingName(false); toast.success('Nome atualizado!'); }} size="sm">Salvar</Button>
                      <Button onClick={() => setEditingName(false)} variant="outline" size="sm">Cancelar</Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2 border border-slate-300 rounded">
                      <span>{newName || 'Não informado'}</span>
                      <Button onClick={() => setEditingName(true)} variant="ghost" size="sm"><Edit2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Senha</label>
                  {editingPassword ? (
                    <div className="space-y-2">
                      <Input type="password" placeholder="Senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                      <Input type="password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                      <Input type="password" placeholder="Confirmar nova senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                      <div className="flex gap-2">
                        <Button onClick={() => { if (newPassword === confirmPassword) { setEditingPassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); toast.success('Senha atualizada!'); } else { toast.error('As senhas não correspondem!'); } }} size="sm">Salvar</Button>
                        <Button onClick={() => { setEditingPassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }} variant="outline" size="sm">Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2 border border-slate-300 rounded">
                      <span>••••••••</span>
                      <Button onClick={() => setEditingPassword(true)} variant="ghost" size="sm"><Edit2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>}

          {/* ─── Aba: Notificações ─────────────────────────────────────────── */}
          {activeTab === 'notifications' && <div className="space-y-6">
            <Card className="bg-white border border-slate-200 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Notificações Gerais</CardTitle>
                <CardDescription>Controle principal de notificações</CardDescription>
              </CardHeader>
              <CardContent>
                <StatusSwitch
                  checked={notificationSettings.notificationsEnabled}
                  onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, notificationsEnabled: v }))}
                  label="Notificações Gerais"
                  description="Ativar/desativar todas as notificações da plataforma"
                  icon={Bell}
                />
              </CardContent>
            </Card>
            <Card className="bg-white border border-slate-200 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Som e Volume</CardTitle>
                <CardDescription>Configure o som das notificações</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusSwitch
                  checked={notificationSettings.soundEnabled}
                  onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, soundEnabled: v }))}
                  label="Som de Notificação"
                  description="Reproduzir som ao receber notificações"
                  icon={Bell}
                />
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-slate-900">Volume do Som</p>
                    <span className="text-sm font-medium text-slate-600">{notificationSettings.soundVolume}%</span>
                  </div>
                  <Slider
                    value={[notificationSettings.soundVolume]}
                    onValueChange={(v) => setNotificationSettings(p => ({ ...p, soundVolume: v[0] }))}
                    max={100} step={1} className="w-full"
                  />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white border border-slate-200 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Tipos de Notificações</CardTitle>
                <CardDescription>Escolha quais notificações deseja receber</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <StatusSwitch checked={notificationSettings.whatsappNotificationsEnabled} onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, whatsappNotificationsEnabled: v }))} label="WhatsApp" description="Notificações de mensagens" icon={MessageSquare} />
                <StatusSwitch checked={notificationSettings.ticketsNotificationsEnabled} onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, ticketsNotificationsEnabled: v }))} label="Chamados" description="Notificações de tickets" icon={Bell} />
                <StatusSwitch checked={notificationSettings.iaNotificationsEnabled} onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, iaNotificationsEnabled: v }))} label="Assistente IA" description="Notificações do assistente" icon={Wifi} />
                <StatusSwitch checked={notificationSettings.erpNotificationsEnabled} onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, erpNotificationsEnabled: v }))} label="ERP" description="Notificações do sistema ERP" icon={Database} />
                <StatusSwitch checked={notificationSettings.trackingNotificationsEnabled} onCheckedChange={(v) => setNotificationSettings(p => ({ ...p, trackingNotificationsEnabled: v }))} label="Rastreamento" description="Notificações de rastreio" icon={MapPin} />
              </CardContent>
            </Card>
          </div>}

          {/* ─── Aba: Atendimento ────────────────────────────────────────── */}
          {activeTab === 'attendance' && <div className="space-y-6">
            <Card className="bg-white">
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
                  <Switch checked={attendanceSettings.autoReplyEnabled} onCheckedChange={(v) => setAttendanceSettings(p => ({ ...p, autoReplyEnabled: v }))} />
                </div>
                {attendanceSettings.autoReplyEnabled && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mensagem de Resposta Automática</label>
                    <textarea
                      placeholder="Digite a mensagem que será enviada automaticamente..."
                      value={attendanceSettings.autoReplyMessage}
                      onChange={(e) => setAttendanceSettings(p => ({ ...p, autoReplyMessage: e.target.value }))}
                      className="w-full p-2 border border-slate-300 rounded text-sm"
                      rows={3}
                    />
                  </div>
                )}
                <div className="border-t pt-4 space-y-4">
                  <p className="font-medium">Atalhos de Mensagens</p>
                  <p className="text-sm text-muted-foreground">Digite / seguido da chave para usar o atalho</p>
                  <div className="space-y-2">
                    <Input placeholder="Chave do atalho (ex: saudacao)" value={newShortcutKey} onChange={(e) => setNewShortcutKey(e.target.value)} />
                    <textarea
                      placeholder="Mensagem do atalho..."
                      value={newShortcutMessage}
                      onChange={(e) => setNewShortcutMessage(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded text-sm"
                      rows={2}
                    />
                    <Button onClick={addShortcut} className="w-full">
                      <Plus className="w-4 h-4 mr-2" /> Adicionar Atalho
                    </Button>
                  </div>
                  {attendanceSettings.shortcuts.length > 0 && (
                    <div className="space-y-2">
                      {attendanceSettings.shortcuts.map((shortcut, index) => (
                        <div key={index} className="flex items-center justify-between p-2 border border-slate-300 rounded">
                          <div>
                            <p className="font-medium text-sm">/{shortcut.key}</p>
                            <p className="text-xs text-muted-foreground">{shortcut.message}</p>
                          </div>
                          <Button onClick={() => removeShortcut(index)} variant="ghost" size="sm">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>}

          {activeTab === 'personalization' && <UserPersonalizationTab />}

          {/* ─── Aba: Geral (ADMIN) ────────────────────────────────────────── */}
          {activeTab === 'geral' && <TabGeral clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Chamados (ADMIN) ────────────────────────────────────────── */}
          {activeTab === 'chamados' && <TabChamados clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Equipe (ADMIN) ───────────────────────────────────────────── */}
          {activeTab === 'equipe' && <TabEquipe clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Backup (ADMIN) ───────────────────────────────────────────── */}
          {activeTab === 'backup' && <TabBackup clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Configurar Bot (ADMIN) ──────────────────────────────────── */}
          {activeTab === 'bot-config' && <BotConfigPage />}

          </div>{/* fim conteúdo */}
        </div>{/* fim flex layout */}
      </div>
    </div>
  );
}
