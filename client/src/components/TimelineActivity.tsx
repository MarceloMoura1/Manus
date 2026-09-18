import React from 'react';
import { CheckCircle, Edit, FileText, Flag, Users, Share2, MessageSquare, User } from 'lucide-react';
import { parseTicketActivityMetadata, type TicketActivityMetadata, type TicketActivityType, type TicketFieldChange } from '@shared/chamados-activity';
import { ticketAttachmentUrl } from '@/lib/trpc-url';

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
  attachment_removed: { icon: <FileText className="h-6 w-6" />, label: 'Anexo', accent: 'border-l-slate-400', tint: 'bg-slate-50 text-slate-600', badge: 'border-slate-200 bg-slate-50 text-slate-700' },
  ticket_created: { icon: <User className="h-6 w-6" />, label: 'Criação', accent: 'border-l-orange-400', tint: 'bg-orange-50 text-orange-600', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
  register: { icon: <User className="h-6 w-6" />, label: 'Criação', accent: 'border-l-orange-400', tint: 'bg-orange-50 text-orange-600', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
  edit: { icon: <Edit className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-amber-400', tint: 'bg-amber-50 text-amber-600', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  close: { icon: <CheckCircle className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-emerald-400', tint: 'bg-emerald-50 text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  forward: { icon: <Share2 className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-indigo-400', tint: 'bg-indigo-50 text-indigo-600', badge: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  attachment: { icon: <FileText className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-emerald-400', tint: 'bg-emerald-50 text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
const fallbackStyle: ActivityStyle = { icon: <MessageSquare className="h-6 w-6" />, label: 'Sistema', accent: 'border-l-slate-400', tint: 'bg-slate-50 text-slate-600', badge: 'border-slate-200 bg-slate-50 text-slate-700' };
Object.assign(activityStyles, {
  ticket_created: { icon: <User className="h-5 w-5" />, label: "Criação", accent: "border-l-blue-400 dark:border-l-blue-500", tint: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300", badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" },
  register: { icon: <User className="h-5 w-5" />, label: "Criação", accent: "border-l-blue-400 dark:border-l-blue-500", tint: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300", badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" },
  status_changed: { icon: <Flag className="h-5 w-5" />, label: "Status", accent: "border-l-sky-400 dark:border-l-sky-500", tint: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300", badge: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" },
  close: { icon: <CheckCircle className="h-5 w-5" />, label: "Status", accent: "border-l-sky-400 dark:border-l-sky-500", tint: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300", badge: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" },
  ticket_edited: { icon: <Edit className="h-5 w-5" />, label: "Edição", accent: "border-l-amber-400 dark:border-l-amber-500", tint: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
  edit: { icon: <Edit className="h-5 w-5" />, label: "Edição", accent: "border-l-amber-400 dark:border-l-amber-500", tint: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
  collaborator_added: { icon: <Users className="h-5 w-5" />, label: "Colaborador", accent: "border-l-violet-400 dark:border-l-violet-500", tint: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300", badge: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300" },
  collaborator_removed: { icon: <Users className="h-5 w-5" />, label: "Colaborador", accent: "border-l-violet-400 dark:border-l-violet-500", tint: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300", badge: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300" },
  ticket_forwarded: { icon: <Share2 className="h-5 w-5" />, label: "Encaminhamento", accent: "border-l-indigo-400 dark:border-l-indigo-500", tint: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300", badge: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300" },
  forward: { icon: <Share2 className="h-5 w-5" />, label: "Encaminhamento", accent: "border-l-indigo-400 dark:border-l-indigo-500", tint: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300", badge: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300" },
  manual_activity: { icon: <MessageSquare className="h-5 w-5" />, label: "Atividade", accent: "border-l-blue-400 dark:border-l-blue-500", tint: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300", badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" },
  note: { icon: <MessageSquare className="h-5 w-5" />, label: "Nota", accent: "border-l-blue-400 dark:border-l-blue-500", tint: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300", badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" },
  attachment_added: { icon: <FileText className="h-5 w-5" />, label: "Anexo", accent: "border-l-emerald-400 dark:border-l-emerald-500", tint: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
  attachment: { icon: <FileText className="h-5 w-5" />, label: "Anexo", accent: "border-l-emerald-400 dark:border-l-emerald-500", tint: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
  attachment_removed: { icon: <FileText className="h-5 w-5" />, label: "Remoção", accent: "border-l-rose-400 dark:border-l-rose-500", tint: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300", badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" },
});

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
    status_changed: 'alterou o status.', collaborator_added: 'adicionou um colaborador.', collaborator_removed: 'removeu um colaborador.', ticket_edited: 'editou o chamado.', ticket_forwarded: 'encaminhou o chamado.', attachment_added: 'adicionou um anexo.', attachment_removed: 'removeu um anexo do chamado.', ticket_created: 'criou o chamado.', close: 'encerrou o chamado.', edit: 'editou o chamado.', forward: 'encaminhou o chamado.', attachment: 'adicionou um anexo.',
  };
  return `${getActivityAuthorName(activity.attendant)} ${verbs[activity.actionType ?? ''] ?? 'registrou uma atividade.'}`;
}

export function shouldRenderActivityNarrative(actionType?: ActivityItem['actionType']) {
  return actionType !== 'note';
}

export function getActivityAccentClass(actionType?: string) {
  return getStyle(actionType).accent;
}

export function getActivityTintClass(actionType?: string) {
  return getStyle(actionType).tint;
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

const statusLabels: Record<string, string> = { open: 'Aberto', in_progress: 'Em andamento', waiting: 'Aguardando', closed: 'Encerrado' };
const fieldLabels: Record<string, string> = { customer: 'Cliente', title: 'Título', observations: 'Observações', priority: 'Prioridade' };
const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const priorityLabels: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

const compactText = (value: string) => value.length > 120 ? `${value.slice(0, 117)}…` : value;

function structuredActivitySummary(activity: ActivityItem, metadata: TicketActivityMetadata | null) {
  const author = getActivityAuthorName(activity.attendant);
  if (metadata?.eventType === 'collaborator_added') return `${author} adicionou ${metadata.collaboratorName} como colaborador.`;
  if (metadata?.eventType === 'collaborator_removed') return `${author} removeu ${metadata.collaboratorName} dos colaboradores.`;
  if (metadata?.eventType === 'attachment_added') return `${author} anexou ${metadata.fileName}.`;
  if (metadata?.eventType === 'attachment_removed') return `${author} removeu o anexo ${metadata.fileName}.`;
  return getActivitySummary(activity);
}

function renderEditChange(change: TicketFieldChange, index: number) {
  const label = fieldLabels[change.field];
  if (change.field === 'observations') {
    const valuesAreShort = [change.from, change.to].every(value => !value || (value.length <= 120 && !/[\r\n]/.test(value)));
    return <li key={`${change.field}-${index}`} className="rounded-md border border-amber-100 bg-white/70 px-3 py-2 dark:border-amber-900/60 dark:bg-slate-900/40"><strong className="text-slate-700 dark:text-slate-200">{label}</strong>{valuesAreShort ? <span className="mt-0.5 block break-words">{change.from || '—'} → {change.to || '—'}</span> : <span className="ml-1">Alterada</span>}</li>;
  }
  const value = (raw: string | null) => {
    if (!raw) return '—';
    return change.field === 'priority' ? priorityLabels[raw] ?? raw : compactText(raw);
  };
  return <li key={`${change.field}-${index}`} className="rounded-md border border-amber-100 bg-white/70 px-3 py-2 dark:border-amber-900/60 dark:bg-slate-900/40"><strong className="text-slate-700 dark:text-slate-200">{label}</strong><span className="mt-0.5 block break-words">{value(change.from)} → {value(change.to)}</span></li>;
}

function renderActivityMetadata(metadata: TicketActivityMetadata | null, chamadoId?: string): React.ReactNode {
  if (!metadata) return null;
  if (metadata.eventType === 'status_changed') return <div data-testid="timeline-status-change" className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><span>{statusLabels[metadata.fromStatus] ?? metadata.fromStatus}</span><span aria-hidden="true" className="text-sky-500">→</span><span>{statusLabels[metadata.toStatus] ?? metadata.toStatus}</span></div>;
  if (metadata.eventType === 'ticket_edited') return <ul data-testid="timeline-edit-changes" className="space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{metadata.changes.map(renderEditChange)}</ul>;
  if (metadata.eventType === 'ticket_forwarded') return <div data-testid="timeline-forward-change" className="space-y-1 text-sm">{metadata.fromAssigneeName ? <div className="flex flex-wrap items-center gap-2 font-medium text-slate-700 dark:text-slate-200"><span>{metadata.fromAssigneeName}</span><span aria-hidden="true" className="text-indigo-500">→</span><span>{metadata.toAssigneeName}</span></div> : <div className="font-medium text-slate-700 dark:text-slate-200">{metadata.toAssigneeName}</div>}{metadata.observation ? <p className="text-xs text-slate-600 dark:text-slate-300">Observação: {compactText(metadata.observation)}</p> : null}</div>;
  if (metadata.eventType === 'attachment_added') {
    const href = attachmentHref(chamadoId, metadata.attachmentId);
    return <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span>{metadata.mimeType} · {formatBytes(metadata.size)}</span>{href ? <a data-testid={`timeline-attachment-view-${metadata.attachmentId}`} href={href} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200">Visualizar arquivo</a> : null}</div>;
  }
  if (metadata.eventType === 'attachment_removed') return <span>{metadata.mimeType} · {formatBytes(metadata.size)} · Removido logicamente</span>;
  return null;
}

function shouldRenderActivityDescription(metadata: TicketActivityMetadata | null) {
  return !metadata || metadata.eventType === 'manual_activity';
}

function attachmentHref(chamadoId: string | undefined, attachmentId: string): string | null {
  if (!chamadoId || !uuid.test(chamadoId) || !uuid.test(attachmentId)) return null;
  return ticketAttachmentUrl(chamadoId, attachmentId);
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
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700"></div>

      {/* Atividades */}
      <div className="space-y-6">
        {activities.map(activity => {
          const { date, time } = formatDateTime(activity.date);
          const badge = getActivityBadge(activity.actionType);
          const metadata = parseTicketActivityMetadata(activity.actionType, activity.metadata);
          const details = renderActivityMetadata(metadata, chamadoId);
          
          return (
            <div key={activity.id} data-testid={`timeline-activity-${activity.id}`} className="relative pl-20">
              {/* Ícone */}
               <div className="absolute left-0 top-0 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white dark:border-slate-950 dark:bg-slate-950">
                <div className={`rounded-full p-1.5 ${getActivityTintClass(activity.actionType)}`}>
                  {getActionIcon(activity.actionType)}
                </div>
              </div>

              {/* Conteúdo */}
              <div data-testid={`timeline-activity-surface-${activity.id}`} className={`overflow-hidden rounded-lg border border-l-2 border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900 ${getActivityAccentClass(activity.actionType)}`}>
                <div data-testid={`timeline-activity-header-${activity.id}`} className={`flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800 ${getActivityTintClass(activity.actionType)}`}>
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
                  <p className="mb-2 text-sm text-slate-700 dark:text-slate-100">
                    <span className="font-medium">{structuredActivitySummary(activity, metadata)}</span>
                  </p>
                )}

                {/* Descrição */}
                {shouldRenderActivityDescription(metadata) && (
                  <div className="mb-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                      {activity.description}
                    </p>
                  </div>
                )}
                {details && (
                  <div data-testid={`timeline-activity-metadata-${activity.id}`} className="mb-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                    {details}
                  </div>
                )}

                {/* Nome do Atendente */}
                <div data-testid={`timeline-activity-author-${activity.id}`} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"><User className="h-3 w-3" /></span>
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
