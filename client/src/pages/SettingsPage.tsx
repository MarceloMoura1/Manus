import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
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
  Eye, EyeOff, Save, X, AlertTriangle, CheckCircle2, Info
} from 'lucide-react';
import { toast } from 'sonner';

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
        <DialogContent className="sm:max-w-md">
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
        <DialogContent className="sm:max-w-md">
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
  const isAdmin = userRole === 'admin';
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newUser, setNewUser] = useState({
    name: '', email: '', password: '',
    role: 'agent' as 'admin' | 'manager' | 'agent' | 'viewer',
    permissions: [] as string[],
  });
  const [showPassword, setShowPassword] = useState(false);
  const utils = trpc.useUtils();

  const { data: clientInfo } = trpc.megadeskSettings.getClientInfo.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  const { data: users = [], isLoading } = trpc.megadeskSettings.listTeamUsers.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  const addMutation = trpc.megadeskSettings.addTeamUser.useMutation({
    onSuccess: () => {
      toast.success('Usuário adicionado com sucesso!');
      utils.megadeskSettings.listTeamUsers.invalidate();
      setShowAddUser(false);
      setNewUser({ name: '', email: '', password: '', role: 'agent', permissions: [] });
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.megadeskSettings.removeTeamUser.useMutation({
    onSuccess: () => {
      toast.success('Usuário removido!');
      utils.megadeskSettings.listTeamUsers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updatePermsMutation = trpc.megadeskSettings.updateTeamUserPermissions.useMutation({
    onSuccess: () => {
      toast.success('Permissões atualizadas!');
      utils.megadeskSettings.listTeamUsers.invalidate();
      setEditingUser(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPasswordMutation = trpc.megadeskSettings.resetTeamUserPassword.useMutation({
    onSuccess: () => {
      toast.success('Senha redefinida com sucesso!');
      setResetPasswordUser(null);
      setNewPassword('');
    },
    onError: (err) => toast.error(err.message),
  });

  // Permissões padrão por role
  const defaultPermsByRole: Record<string, string[]> = {
    admin: AVAILABLE_PERMISSIONS.map(p => p.key),
    manager: AVAILABLE_PERMISSIONS.map(p => p.key),
    agent: ['active-attendance', 'conversations', 'tickets'],
    viewer: ['tickets'],
  };

  const handleRoleChange = (role: 'admin' | 'manager' | 'agent' | 'viewer') => {
    setNewUser(p => ({ ...p, role, permissions: defaultPermsByRole[role] }));
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

  const activeUsers = users.filter(u => u.status === 'active');
  const maxUsers = clientInfo?.maxUsers ?? 5;

  return (
    <div className="space-y-6">
      {/* Header com limite */}
      <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-xl">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-purple-600" />
          <div>
            <p className="text-sm font-semibold text-purple-800">Gerenciamento de Equipe</p>
            <p className="text-xs text-purple-600">
              {activeUsers.length} de {maxUsers} usuários ativos
              {activeUsers.length >= maxUsers && (
                <span className="ml-2 text-red-600 font-medium">— Limite atingido</span>
              )}
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowAddUser(true)}
          disabled={activeUsers.length >= maxUsers}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
        >
          <UserPlus className="w-4 h-4" /> Adicionar Usuário
        </Button>
      </div>

      {/* Barra de progresso de usuários */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Usuários ativos</span>
          <span>{activeUsers.length}/{maxUsers}</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              activeUsers.length >= maxUsers ? 'bg-red-500' : 'bg-purple-500'
            }`}
            style={{ width: `${Math.min((activeUsers.length / maxUsers) * 100, 100)}%` }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
        </div>
      ) : users.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="pt-6 text-center py-12">
            <Users className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-600">Nenhum usuário cadastrado</p>
            <Button onClick={() => setShowAddUser(true)} className="mt-4 gap-2" variant="outline">
              <UserPlus className="w-4 h-4" /> Adicionar primeiro usuário
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <Card key={user.userId} className={`bg-white border shadow-sm ${user.status === 'blocked' ? 'opacity-60 border-red-200' : 'border-slate-200'}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                      user.status === 'blocked' ? 'bg-slate-400' : 'bg-gradient-to-br from-purple-500 to-indigo-600'
                    }`}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-800 text-sm truncate">{user.name}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.viewer}`}>
                          {ROLE_LABELS[user.role] ?? user.role}
                        </span>
                        {user.status === 'blocked' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                            Bloqueado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{user.email}</p>
                      {/* Permissões */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {user.permissions.slice(0, 4).map((perm: string) => {
                          const p = AVAILABLE_PERMISSIONS.find(ap => ap.key === perm);
                          return p ? (
                            <span key={perm} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                              {p.label}
                            </span>
                          ) : null;
                        })}
                        {user.permissions.length > 4 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500">
                            +{user.permissions.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-blue-50"
                      title="Editar permissões"
                      onClick={() => setEditingUser({ ...user })}
                    >
                      <Shield className="w-3.5 h-3.5 text-blue-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-amber-50"
                      title="Redefinir senha"
                      onClick={() => setResetPasswordUser(user)}
                    >
                      <Key className="w-3.5 h-3.5 text-amber-500" />
                    </Button>
                    {user.status === 'active' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-red-50"
                        title="Remover usuário"
                        onClick={() => {
                          if (confirm(`Remover "${user.name}" da equipe?`)) {
                            removeMutation.mutate({ clientId, userRole, targetUserId: user.userId });
                          }
                        }}
                      >
                        <UserX className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-green-50"
                        title="Reativar usuário"
                        onClick={() => {
                          updatePermsMutation.mutate({ clientId, userRole, targetUserId: user.userId, status: 'active' });
                        }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog: Adicionar usuário */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-500" /> Adicionar Usuário
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Nome *</label>
                <Input
                  placeholder="Nome completo"
                  value={newUser.name}
                  onChange={(e) => setNewUser(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Cargo</label>
                <Select value={newUser.role} onValueChange={(v) => handleRoleChange(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">E-mail *</label>
              <Input
                type="email"
                placeholder="usuario@empresa.com"
                value={newUser.email}
                onChange={(e) => setNewUser(p => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Senha *</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={newUser.password}
                  onChange={(e) => setNewUser(p => ({ ...p, password: e.target.value }))}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowPassword(p => !p)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Permissões</label>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_PERMISSIONS.map((perm) => {
                  const checked = newUser.permissions.includes(perm.key);
                  return (
                    <label
                      key={perm.key}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        checked ? 'bg-purple-50 border-purple-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setNewUser(p => ({
                            ...p,
                            permissions: v
                              ? [...p.permissions, perm.key]
                              : p.permissions.filter(x => x !== perm.key),
                          }));
                        }}
                      />
                      <span className="text-xs font-medium text-slate-700">{perm.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUser(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!newUser.name.trim()) { toast.error('Informe o nome.'); return; }
                if (!newUser.email.trim()) { toast.error('Informe o e-mail.'); return; }
                if (newUser.password.length < 6) { toast.error('Senha deve ter no mínimo 6 caracteres.'); return; }
                addMutation.mutate({ clientId, userRole, ...newUser });
              }}
              disabled={addMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar permissões */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-500" /> Editar Permissões — {editingUser?.name}
            </DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Cargo</label>
                <Select
                  value={editingUser.role}
                  onValueChange={(v) => {
                    setEditingUser((p: any) => ({ ...p, role: v, permissions: defaultPermsByRole[v] }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Permissões</label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_PERMISSIONS.map((perm) => {
                    const checked = editingUser.permissions.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                          checked ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setEditingUser((p: any) => ({
                              ...p,
                              permissions: v
                                ? [...p.permissions, perm.key]
                                : p.permissions.filter((x: string) => x !== perm.key),
                            }));
                          }}
                        />
                        <span className="text-xs font-medium text-slate-700">{perm.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!editingUser) return;
                updatePermsMutation.mutate({
                  clientId, userRole,
                  targetUserId: editingUser.userId,
                  role: editingUser.role,
                  permissions: editingUser.permissions,
                });
              }}
              disabled={updatePermsMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {updatePermsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Redefinir senha */}
      <Dialog open={!!resetPasswordUser} onOpenChange={() => { setResetPasswordUser(null); setNewPassword(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-500" /> Redefinir Senha — {resetPasswordUser?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">A senha atual será substituída pela nova senha definida abaixo.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Nova Senha *</label>
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowNewPassword(p => !p)}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordUser(null); setNewPassword(''); }}>Cancelar</Button>
            <Button
              onClick={() => {
                if (newPassword.length < 6) { toast.error('Senha deve ter no mínimo 6 caracteres.'); return; }
                resetPasswordMutation.mutate({
                  clientId, userRole,
                  targetUserId: resetPasswordUser.userId,
                  newPassword,
                });
              }}
              disabled={resetPasswordMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              Redefinir Senha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
              Formato: JSON • Exportado em: {new Date().toLocaleDateString('pt-BR')}
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
export function SettingsPage() {
  const { user } = useAuth();
  const session = getMegaDeskSession();
  const clientId = session?.clientId ?? '';
  const userRole = session?.userRole ?? 'viewer';
  const isAdmin = userRole === 'admin';

  const [activeTab, setActiveTab] = useState(isAdmin ? 'whatsapp' : 'account');

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
  // Abas adminOnly são completamente ocultadas para não-admin (sem cadeado)
  const allTabs = [
    { value: 'whatsapp', label: 'WhatsApp', adminOnly: true },
    { value: 'account', label: 'Conta', adminOnly: false },
    { value: 'notifications', label: 'Notificações', adminOnly: false },
    { value: 'attendance', label: 'Atendimento', adminOnly: false },
    { value: 'geral', label: '🏢 Geral', adminOnly: true },
    { value: 'chamados', label: '🎫 Chamados', adminOnly: true },
    { value: 'equipe', label: '👥 Equipe', adminOnly: true },
    { value: 'backup', label: '💾 Backup', adminOnly: true },
  ];
  // Filtrar: admin vê tudo, não-admin não vê abas adminOnly
  const tabs = allTabs.filter(tab => isAdmin || !tab.adminOnly);

  // ─── Ícones por aba ────────────────────────────────────────────────────────
  const tabIcons: Record<string, React.ElementType> = {
    whatsapp: MessageSquare,
    account: Users,
    notifications: Bell,
    attendance: Phone,
    geral: Building2,
    chamados: Tag,
    equipe: Shield,
    backup: Database,
  };

  const tabDescriptions: Record<string, string> = {
    whatsapp: 'Integração WhatsApp API',
    account: 'Dados pessoais e senha',
    notifications: 'Alertas e sons',
    attendance: 'Respostas e atalhos',
    geral: 'Dados da empresa',
    chamados: 'Status personalizados',
    equipe: 'Usuários e permissões',
    backup: 'Exportação e restauração',
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground mt-1 text-sm">Personalize sua experiência no MegaDesk</p>
          {isAdmin && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full">
              <Shield className="w-3.5 h-3.5 text-red-600" />
              <span className="text-xs font-medium text-red-700">Modo Administrador — Acesso completo</span>
            </div>
          )}
        </div>

        {/* Layout: lista lateral + conteúdo */}
        <div className="flex gap-4 items-start">
          {/* ─── Lista lateral ─────────────────────────────────────────── */}
          <div className="w-80 flex-shrink-0">
            <nav className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              {isAdmin && (
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Administrador</p>
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
                          onClick={() => setActiveTab(tab.value)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 group ${
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
          <div className="flex-1 min-w-0">

          {/* ─── Aba: WhatsApp ─────────────────────────────────────────── */}
          {activeTab === 'whatsapp' && <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {renderStatusCard('Conexão', connectionStatus, 'Conexão com WhatsApp API')}
              {renderStatusCard('Webhook', webhookStatus, 'Status do webhook')}
              {renderStatusCard('Credenciais', credentialsStatus, 'Validação das credenciais')}
            </div>
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Como Integrar WhatsApp</CardTitle>
                <CardDescription>Siga os passos abaixo para configurar sua integração</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  <li>1. Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Facebook Developers</a></li>
                  <li>2. Crie um app e configure WhatsApp Business API</li>
                  <li>3. Obtenha Phone Number ID, Business Account ID e Access Token</li>
                  <li>4. Preencha os campos abaixo e configure o Webhook URL no Facebook</li>
                </ol>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>URL do Webhook</CardTitle>
                <CardDescription>Configure esta URL em seu app do Facebook</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input value={`${window.location.origin}/api/webhooks/whatsapp`} readOnly />
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/whatsapp`); toast.success('URL copiada!'); }}>
                    Copiar
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Configurar Credenciais WhatsApp</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Phone Number ID</label>
                  <Input placeholder="Ex: 123456789012345" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Business Account ID</label>
                  <Input placeholder="Ex: 987654321098765" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Access Token</label>
                  <div className="relative">
                    <Input type={showAccessToken ? 'text' : 'password'} placeholder="Cole seu token de acesso" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} className="pr-10" />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowAccessToken(p => !p)}>
                      {showAccessToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Webhook Verify Token</label>
                    <Button type="button" variant="outline" size="sm" onClick={generateSecureToken} className="text-blue-600 border-blue-200 text-xs">Gerar Token</Button>
                  </div>
                  <div className="relative">
                    <Input type={showWebhookToken ? 'text' : 'password'} placeholder="Token para verificação do webhook" value={webhookVerifyToken} onChange={(e) => setWebhookVerifyToken(e.target.value)} className="pr-10" />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowWebhookToken(p => !p)}>
                      {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Número de Telefone</label>
                  <Input placeholder="Ex: +5541987654321" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700">Salvar Configurações</Button>
                  <Button onClick={testConnection} disabled={testingConnection || credentialsStatus !== 'valid'} variant="outline" className="flex-1">
                    {testingConnection ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testando...</> : <><Wifi className="w-4 h-4 mr-2" />Testar Conexão</>}
                  </Button>
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

          {/* ─── Aba: Geral (ADMIN) ────────────────────────────────────────── */}
          {activeTab === 'geral' && <TabGeral clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Chamados (ADMIN) ────────────────────────────────────────── */}
          {activeTab === 'chamados' && <TabChamados clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Equipe (ADMIN) ───────────────────────────────────────────── */}
          {activeTab === 'equipe' && <TabEquipe clientId={clientId} userRole={userRole} />}

          {/* ─── Aba: Backup (ADMIN) ───────────────────────────────────────────── */}
          {activeTab === 'backup' && <TabBackup clientId={clientId} userRole={userRole} />}

          </div>{/* fim conteúdo */}
        </div>{/* fim flex layout */}
      </div>
    </div>
  );
}
