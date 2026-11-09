import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Users, Shield, Key, UserPlus, UserX, Trash2, Edit2, Loader2,
  Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, AlertCircle, Save, Check
} from 'lucide-react';
import { toast } from 'sonner';

export const AVAILABLE_PERMISSIONS = [
  { key: 'active-attendance', label: 'Atendimento Ativo' },
  { key: 'conversations', label: 'Conversas' },
  { key: 'tickets', label: 'Chamados' },
  { key: 'tracking', label: 'Rastreamento' },
  { key: 'erp', label: 'ERP' },
  { key: 'clients', label: 'Clientes' },
  { key: 'bot-config', label: 'Configurar Bot' },
  { key: 'ai-assistant', label: 'Assistente IA' },
];

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  agent: 'Atendente',
  viewer: 'Visualizador',
};

export const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  manager: 'bg-purple-100 text-purple-700 border-purple-200',
  agent: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer: 'bg-gray-100 text-gray-700 border-gray-200',
};

const defaultPermsByRole: Record<string, string[]> = {
  admin: AVAILABLE_PERMISSIONS.map(p => p.key),
  manager: AVAILABLE_PERMISSIONS.map(p => p.key),
  agent: ['active-attendance', 'conversations', 'tickets'],
  viewer: ['tickets'],
};

interface TeamUser {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'agent' | 'viewer';
  status: 'active' | 'blocked';
  permissions: string[];
}

export function TeamTab({ clientId, userRole }: { clientId: string; userRole: string }) {
  const isAdmin = userRole === 'admin';
  const utils = trpc.useUtils();

  // Estados de modais
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Estado para novo usuário
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'agent' as 'admin' | 'manager' | 'agent' | 'viewer',
    permissions: defaultPermsByRole['agent'],
  });
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Queries
  const { data: clientInfo } = trpc.megadeskSettings.getClientInfo.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  const { data: users = [], isLoading } = trpc.team.listUsers.useQuery(
    { clientId, userRole },
    { enabled: isAdmin, retry: false }
  );

  // Invalidação unificada de queries
  const invalidateTeamQueries = () => {
    utils.team.listUsers.invalidate();
    utils.megadeskSettings.listTeamUsers.invalidate();
  };

  // Mutations
  const addMutation = trpc.team.addUser.useMutation({
    onSuccess: () => {
      toast.success('Usuário adicionado com sucesso!');
      invalidateTeamQueries();
      setShowAddUser(false);
      setNewUser({
        name: '',
        email: '',
        password: '',
        role: 'agent',
        permissions: defaultPermsByRole['agent'],
      });
    },
    onError: (err) => toast.error(err.message || 'Erro ao adicionar usuário.'),
  });

  const updateMutation = trpc.team.updateUser.useMutation({
    onSuccess: () => {
      toast.success('Usuário atualizado com sucesso!');
      invalidateTeamQueries();
      setEditingUser(null);
      setEditPassword('');
    },
    onError: (err) => toast.error(err.message || 'Erro ao atualizar usuário.'),
  });

  const deleteMutation = trpc.team.deleteUser.useMutation({
    onSuccess: () => {
      toast.success('Usuário excluído com sucesso!');
      invalidateTeamQueries();
      if (editingUser) setEditingUser(null);
    },
    onError: (err) => toast.error(err.message || 'Erro ao excluir usuário.'),
  });

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <Card className="border-slate-200">
          <CardContent className="pt-6 text-center text-slate-500 py-12">
            <Lock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-700">Acesso Restrito</p>
            <p className="text-sm text-slate-500 mt-1">Apenas administradores podem gerenciar a equipe.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeUsers = users.filter((u) => u.status === 'active');
  const maxUsers = clientInfo?.maxUsers ?? 5;

  const handleRoleChangeForNew = (role: 'admin' | 'manager' | 'agent' | 'viewer') => {
    setNewUser((p) => ({ ...p, role, permissions: defaultPermsByRole[role] ?? [] }));
  };

  const handleRoleChangeForEdit = (role: 'admin' | 'manager' | 'agent' | 'viewer') => {
    if (!editingUser) return;
    setEditingUser((p) => (p ? { ...p, role, permissions: defaultPermsByRole[role] ?? [] } : null));
  };

  const handleDeleteUser = (user: TeamUser) => {
    if (confirm(`Tem certeza de que deseja EXCLUIR definitivamente o usuário "${user.name}" (${user.email})? Esta ação não pode ser desfeita.`)) {
      deleteMutation.mutate({ clientId, userRole, userId: user.userId });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header com limites da empresa */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-purple-100 text-purple-700">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-purple-900">Gerenciamento de Equipe</p>
            <p className="text-xs text-purple-700">
              {activeUsers.length} de {maxUsers} usuários ativos contratados
              {activeUsers.length >= maxUsers && (
                <span className="ml-2 font-semibold text-red-600">— Limite do plano atingido</span>
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

      {/* Barra de Progresso de Usuários */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500 font-medium">
          <span>Ocupação da equipe</span>
          <span>{activeUsers.length} / {maxUsers} ativos</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              activeUsers.length >= maxUsers ? 'bg-red-500' : 'bg-purple-600'
            }`}
            style={{ width: `${Math.min((activeUsers.length / maxUsers) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Lista de Usuários */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
        </div>
      ) : users.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="pt-6 text-center py-12">
            <Users className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-700">Nenhum usuário cadastrado</p>
            <p className="text-xs text-slate-400 mt-1">Adicione o primeiro membro da sua equipe para começar.</p>
            <Button onClick={() => setShowAddUser(true)} className="mt-4 gap-2 bg-purple-600 hover:bg-purple-700 text-white">
              <UserPlus className="w-4 h-4" /> Adicionar Primeiro Usuário
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isBlocked = user.status === 'blocked';
            return (
              <Card
                key={user.userId}
                className={`bg-white border transition-shadow hover:shadow-md ${
                  isBlocked ? 'border-red-200 bg-red-50/20 opacity-80' : 'border-slate-200'
                }`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 flex-1 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm ${
                          isBlocked
                            ? 'bg-slate-400'
                            : user.role === 'admin'
                            ? 'bg-gradient-to-br from-red-500 to-rose-600'
                            : 'bg-gradient-to-br from-purple-500 to-indigo-600'
                        }`}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900 text-sm truncate">{user.name}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.viewer}`}>
                            {ROLE_LABELS[user.role] ?? user.role}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              isBlocked
                                ? 'bg-red-100 text-red-700 border-red-200'
                                : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {isBlocked ? 'Inativo / Bloqueado' : 'Ativo'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>

                        {/* Badges de permissões */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {user.permissions.slice(0, 5).map((perm) => {
                            const p = AVAILABLE_PERMISSIONS.find((ap) => ap.key === perm);
                            return p ? (
                              <span key={perm} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                                {p.label}
                              </span>
                            ) : null;
                          })}
                          {user.permissions.length > 5 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500">
                              +{user.permissions.length - 5}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Botões de Ação */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                        title="Editar usuário completo"
                        onClick={() => {
                          setEditingUser({ ...user });
                          setEditPassword('');
                          setShowEditPassword(false);
                        }}
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        title="Excluir usuário"
                        onClick={() => handleDeleteUser(user)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── MODAL COMPLETO DE EDIÇÃO DE USUÁRIO ─────────────────────────────── */}
      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null); }}>
        <DialogContent className="sm:max-w-lg bg-white border border-slate-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Edit2 className="w-5 h-5 text-blue-600" />
              Editar Usuário — {editingUser?.name}
            </DialogTitle>
          </DialogHeader>

          {editingUser && (
            <div className="space-y-4 py-2 text-slate-800">
              {/* Nome completo */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Nome Completo *
                </label>
                <Input
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  placeholder="Nome do usuário"
                />
              </div>

              {/* E-mail (com validação de unicidade) */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  E-mail *
                </label>
                <Input
                  type="email"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  placeholder="usuario@empresa.com"
                />
              </div>

              {/* Cargo e Status */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Cargo / Papel
                  </label>
                  <Select
                    value={editingUser.role}
                    onValueChange={(v) => handleRoleChangeForEdit(v as any)}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </label>
                  <Select
                    value={editingUser.status}
                    onValueChange={(v) => setEditingUser({ ...editingUser, status: v as 'active' | 'blocked' })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="blocked">Inativo / Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Redefinição de Senha (opcional) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Key className="w-3.5 h-3.5 text-amber-500" />
                    <span>Redefinir Senha (opcional)</span>
                  </div>
                  <span className="text-[11px] text-slate-400">Deixe em branco para manter a atual</span>
                </div>
                <div className="relative">
                  <Input
                    type={showEditPassword ? 'text' : 'password'}
                    placeholder="Digite nova senha (mínimo 6 caracteres)"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="pr-10 bg-white"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                  >
                    {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Permissões */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Permissões de Acesso
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 border rounded-lg border-slate-100">
                  {AVAILABLE_PERMISSIONS.map((perm) => {
                    const checked = editingUser.permissions.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                          checked ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => {
                            setEditingUser({
                              ...editingUser,
                              permissions: val
                                ? [...editingUser.permissions, perm.key]
                                : editingUser.permissions.filter((k) => k !== perm.key),
                            });
                          }}
                        />
                        <span className="truncate">{perm.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t pt-3">
            {/* Ação de Excluir dentro do próprio modal de edição */}
            {editingUser && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="gap-1.5 w-full sm:w-auto"
                onClick={() => handleDeleteUser(editingUser)}
                disabled={deleteMutation.isPending || updateMutation.isPending}
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir Usuário
              </Button>
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingUser(null)}
                disabled={updateMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                disabled={updateMutation.isPending}
                onClick={() => {
                  if (!editingUser) return;
                  if (!editingUser.name.trim()) {
                    toast.error('Informe o nome do usuário.');
                    return;
                  }
                  if (!editingUser.email.trim()) {
                    toast.error('Informe o e-mail do usuário.');
                    return;
                  }
                  if (editPassword && editPassword.trim().length < 6) {
                    toast.error('A nova senha deve ter no mínimo 6 caracteres.');
                    return;
                  }

                  updateMutation.mutate({
                    clientId,
                    userRole,
                    userId: editingUser.userId,
                    name: editingUser.name.trim(),
                    email: editingUser.email.trim().toLowerCase(),
                    role: editingUser.role,
                    status: editingUser.status,
                    permissions: editingUser.permissions,
                    password: editPassword.trim() || undefined,
                  });
                }}
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Alterações
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL DE ADICIONAR USUÁRIO ───────────────────────────────────────── */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent className="sm:max-w-lg bg-white border border-slate-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <UserPlus className="w-5 h-5 text-purple-600" />
              Adicionar Novo Usuário
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-slate-800">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Nome Completo *
                </label>
                <Input
                  placeholder="Nome do usuário"
                  value={newUser.name}
                  onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Cargo
                </label>
                <Select
                  value={newUser.role}
                  onValueChange={(v) => handleRoleChangeForNew(v as any)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                E-mail *
              </label>
              <Input
                type="email"
                placeholder="usuario@empresa.com"
                value={newUser.email}
                onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Senha de Acesso *
              </label>
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={newUser.password}
                  onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                  className="pr-10 bg-white"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Permissões de Acesso
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 border rounded-lg border-slate-100">
                {AVAILABLE_PERMISSIONS.map((perm) => {
                  const checked = newUser.permissions.includes(perm.key);
                  return (
                    <label
                      key={perm.key}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        checked ? 'bg-purple-50 border-purple-200 text-purple-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(val) => {
                          setNewUser((p) => ({
                            ...p,
                            permissions: val
                              ? [...p.permissions, perm.key]
                              : p.permissions.filter((x) => x !== perm.key),
                          }));
                        }}
                      />
                      <span className="truncate">{perm.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddUser(false)}
              disabled={addMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
              disabled={addMutation.isPending}
              onClick={() => {
                if (!newUser.name.trim()) { toast.error('Informe o nome do usuário.'); return; }
                if (!newUser.email.trim()) { toast.error('Informe o e-mail do usuário.'); return; }
                if (newUser.password.length < 6) { toast.error('A senha deve ter no mínimo 6 caracteres.'); return; }

                addMutation.mutate({
                  clientId,
                  userRole,
                  name: newUser.name.trim(),
                  email: newUser.email.trim().toLowerCase(),
                  password: newUser.password,
                  role: newUser.role,
                  permissions: newUser.permissions,
                });
              }}
            >
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Adicionar à Equipe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

