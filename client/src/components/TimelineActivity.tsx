import React from 'react';
import { CheckCircle, Edit, FileText, Flag, Users, Share2, MessageSquare, User } from 'lucide-react';
import { parseTicketActivityMetadata, type TicketActivityMetadata, type TicketActivityType } from '@shared/chamados-activity';

export interface ActivityItem {
  id: string;
  date: number; // timestamp em millisegundos
  description: string;
  attendant: string;
  actorUserId?: string | null;
  actionType?: TicketActivityType | string;
  metadata?: unknown;
}

interface TimelineActivityProps {
  activities: ActivityItem[];
  chamadoId?: string;
}

type ActivityStyle = { icon: React.ReactNode; label: string; accent: string; tint: string; badge: string };

const activityStyles: Record<string, ActivityStyle> = {
  note: { icon: <MessageSquare className="h-6 w-6" />, label: 'Nota', accent: 'border-l-blue-400', tint: 'bg-blue-50 text-blue-600', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  manual_activity: { icon: <MessageSquare className="h-6 w-6" />, label: 'Nota', accent: 'border-l-blue-400', tint: 'bg-blue-50 text-blue-600', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  status_changed: { icon: <Flag className="h-6 w-6" />, label: 'Status', accent: 'border-l-sky-400', tint: 'bg-sky-50 text-sky-600', badge: 'border-sky-200 bg-sky-50 text-sky-700' },
  collaborator_added: { icon: <Users className="h-6 w-6" />, label: 'Colaborador', accent: 'border-l-violet-400', tint: 'bg-violet-50 text-violet-600', badge: 'border-violet-200 bg-violet-50 text-violet-700' },
  collaborator_removed: { icon: <Users className="h-6 w-6" />, label: 'Colaborador', accent: 'border-l-violet-400', tint: 'bg-violet-50 text-violet-600', badge: 'border-violet-200 bg-violet-50 text-violet-700' },
  ticket_edited: { icon: <Edit className="h-6 w-6" />, label: 'Edição', accent: 'border-l-amber-400', tint: 'bg-amber-50 text-amber-600', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  ticket_forwarded: { icon: <Share2 className="h-6 w-6" />, label: 'Encaminhamento', accent: 'border-l-indigo-400', tint: 'bg-indigo-50 text-indigo-600', badge: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  attachment_added: { icon: <FileText className="h-6 w-6" />, label: 'Anexo', accent: 'border-l-emerald-400', tint: 'bg-emerald-50 text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  ticket_created: { icon: <User className="h-6 w-6" />, label: 'Criação', accent: 'border-l-orange-400', tint: 'bg-orange-50 text-orange-600', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
  register: { icon: <User className="h-6 w-6" />, label: 'Criação', accent: 'border-l-orange-400', tint: 'bg-orange-50 text-orange-600', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
  edit: { icon: <Edit className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-amber-400', tint: 'bg-amber-50 text-amber-600', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  close: { icon: <CheckCircle className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-emerald-400', tint: 'bg-emerald-50 text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  forward: { icon: <Share2 className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-indigo-400', tint: 'bg-indigo-50 text-indigo-600', badge: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  attachment: { icon: <FileText className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-emerald-400', tint: 'bg-emerald-50 text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
const fallbackStyle: ActivityStyle = { icon: <MessageSquare className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-slate-400', tint: 'bg-slate-50 text-slate-600', badge: 'border-slate-200 bg-slate-50 text-slate-700' };
const getStyle = (actionType?: string) => activityStyles[actionType ?? ''] ?? fallbackStyle;
const getActionIcon = (actionType?: string) => getStyle(actionType).icon;

export function getActivityAuthorName(attendant?: string) {
  const normalizedName = attendant?.trim();

  // Activities persisted before canonical authorship was introduced only have a
  // display snapshot. A generic snapshot is not evidence of a real person, so
  // keep the fallback neutral instead of guessing across users or tenants.
  if (!normalizedName || normalizedName.toLocaleLowerCase('pt-BR') === 'atendente') {
    return 'Autor não identificado';
  }

  return normalizedName;
}

export function getActivitySummary(activity: Pick<ActivityItem, 'attendant' | 'actionType'>) {
  const verbs: Record<string, string> = {
    status_changed: 'alterou o status.', collaborator_added: 'adicionou um colaborador.', collaborator_removed: 'removeu um colaborador.', ticket_edited: 'editou o chamado.', ticket_forwarded: 'encaminhou o chamado.', attachment_added: 'adicionou um anexo.', ticket_created: 'criou o chamado.', close: 'encerrou o chamado.', edit: 'editou o chamado.', forward: 'encaminhou o chamado.', attachment: 'adicionou um anexo.',
  };
  return `${getActivityAuthorName(activity.attendant)} ${verbs[activity.actionType ?? ''] ?? 'registrou uma atividade.'}`;
}

export function shouldRenderActivityNarrative(actionType?: ActivityItem['actionType']) {
  return !['note', 'manual_activity', 'register'].includes(actionType ?? '');
}

export function getActivityAccentClass(actionType?: string) {
  return getStyle(actionType).accent;
}

export function getActivityTintClass(actionType?: string) {
  return getStyle(actionType).tint.split(' ')[0];
}

export function getActivityBadge(actionType?: ActivityItem['actionType']) {
  const style = getStyle(actionType);
  return { label: style.label, className: style.badge };

  switch (actionType) {
    case 'close':
      return { label: 'Sistema', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
    case 'forward':
      return { label: 'Colaborador', className: 'border-violet-200 bg-violet-50 text-violet-700' };
    case 'edit':
      return { label: 'Alteração', className: 'border-violet-200 bg-violet-50 text-violet-700' };
    case 'register':
      return { label: 'Criação', className: 'border-amber-200 bg-amber-50 text-amber-700' };
    case 'note':
    default:
      return { label: 'Nota', className: 'border-blue-200 bg-blue-50 text-blue-700' };
  }
}

import { formatDate, formatTime } from '@/lib/conversationDateTime';

const formatDateTime = (date: number | string | Date) => {
  const formattedDate = formatDate(date, 'Data inválida');
  const formattedTime = formatTime(date, '--:--');
  return {
    date: formattedDate,
    time: formattedTime,
  };
};

const statusLabels: Record<string, string> = { open: 'Aberto', in_progress: 'Em Progresso', waiting: 'Aguardando', closed: 'Fechado' };
const fieldLabels: Record<string, string> = { customer: 'Cliente', title: 'Título', observations: 'Observações', priority: 'Prioridade' };
const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function attachmentHref(chamadoId: string | undefined, attachmentId: string): string | null {
  if (!chamadoId || !uuid.test(chamadoId) || !uuid.test(attachmentId)) return null;
  return `/api/chamados/${encodeURIComponent(chamadoId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
}

function renderMetadata(metadata: TicketActivityMetadata | null, chamadoId?: string): React.ReactNode {
  if (!metadata) return null;
  if (metadata.eventType === 'status_changed') return <>Status: <strong>{statusLabels[metadata.fromStatus] ?? metadata.fromStatus}</strong> → <strong>{statusLabels[metadata.toStatus] ?? metadata.toStatus}</strong></>;
  if (metadata.eventType === 'collaborator_added') return <>Adicionado: <strong>{metadata.collaboratorName}</strong></>;
  if (metadata.eventType === 'collaborator_removed') return <>Removido: <strong>{metadata.collaboratorName}</strong></>;
  if (metadata.eventType === 'ticket_forwarded') return <><span>Destino: <strong>{metadata.toAssigneeName}</strong></span>{metadata.observation ? <span className="mt-1 block whitespace-pre-wrap">Observação: {metadata.observation}</span> : null}</>;
  if (metadata.eventType === 'ticket_edited') return <ul className="space-y-1">{metadata.changes.map((change, index) => <li key={`${change.field}-${index}`}><strong>{fieldLabels[change.field]}</strong>: {change.from || '—'} → {change.to || '—'}</li>)}</ul>;
  if (metadata.eventType === 'attachment_added') {
    const href = attachmentHref(chamadoId, metadata.attachmentId);
    return <><span>{metadata.mimeType} · {formatBytes(metadata.size)}</span>{href ? <a href={href} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800">Visualizar arquivo</a> : null}</>;
  }
  return null;
}

export const TimelineActivity: React.FC<TimelineActivityProps> = ({ activities, chamadoId }) => {
  if (!activities || activities.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <p>Nenhuma atividade registrada ainda.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Linha vertical */}
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-200"></div>

      {/* Atividades */}
      <div className="space-y-6">
        {activities.map((activity, index) => {
          const { date, time } = formatDateTime(activity.date);
          const badge = getActivityBadge(activity.actionType);
          const metadata = parseTicketActivityMetadata(activity.actionType, activity.metadata);
          
          return (
            <div key={activity.id} data-testid={`timeline-activity-${activity.id}`} className="relative pl-20">
              {/* Ícone */}
              <div className="absolute left-0 top-0 w-16 h-16 flex items-center justify-center bg-white rounded-full border-4 border-white">
                <div className={`rounded-full p-1.5 ${getActivityTintClass(activity.actionType)}`}>
                  {getActionIcon(activity.actionType)}
                </div>
              </div>

              {/* Conteúdo */}
              <div data-testid={`timeline-activity-surface-${activity.id}`} className={`overflow-hidden rounded-lg border border-l-2 border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${getActivityAccentClass(activity.actionType)}`}>
                <div data-testid={`timeline-activity-header-${activity.id}`} className={`flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 ${getActivityTintClass(activity.actionType)}`}>
                {/* Data e Hora */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">{date}</span>
                    <span className="text-xs text-slate-500">{time}</span>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}>{badge.label}</span>
                </div>

                <div className="p-4">

                {/* Eventos estruturais precisam do resumo; notas e apontamentos já têm conteúdo próprio. */}
                {shouldRenderActivityNarrative(activity.actionType) && (
                  <p className="mb-2 text-sm text-slate-700">
                    <span className="font-medium">{getActivitySummary(activity)}</span>
                  </p>
                )}

                {/* Descrição */}
                <div className="mb-3 rounded-lg bg-slate-50 p-3">
                   <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                     {activity.description}
                   </p>
                   {metadata && (
                     <div data-testid={`timeline-activity-metadata-${activity.id}`} className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
                        {renderMetadata(metadata, chamadoId)}
                     </div>
                   )}
                 </div>

                {/* Nome do Atendente */}
                <div data-testid={`timeline-activity-author-${activity.id}`} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600"><User className="h-3 w-3" /></span>
                  <span>{getActivityAuthorName(activity.attendant)}</span>
                </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
