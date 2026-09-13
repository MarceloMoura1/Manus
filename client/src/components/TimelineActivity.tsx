import React from 'react';
import { CheckCircle, Edit, Users, Share2, MessageSquare, User } from 'lucide-react';

export interface ActivityItem {
  id: string;
  date: number; // timestamp em millisegundos
  description: string;
  attendant: string;
  actionType?: 'register' | 'edit' | 'close' | 'forward' | 'note';
}

interface TimelineActivityProps {
  activities: ActivityItem[];
}

const getActionIcon = (actionType?: string) => {
  switch (actionType) {
    case 'close':
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    case 'edit':
      return <Edit className="w-6 h-6 text-violet-500" />;
    case 'forward':
      return <Share2 className="w-6 h-6 text-purple-500" />;
    case 'register':
      return <User className="w-6 h-6 text-blue-500" />;
    case 'note':
    default:
      return <MessageSquare className="w-6 h-6 text-blue-500" />;
  }
};

const getActionLabel = (actionType?: string) => {
  switch (actionType) {
    case 'close':
      return 'encerrou o chamado.';
    case 'edit':
      return 'editou o chamado.';
    case 'forward':
      return 'encaminhou o chamado.';
    case 'register':
      return 'registrou um apontamento.';
    case 'note':
    default:
      return 'registrou uma nota.';
  }
};

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
  return `${getActivityAuthorName(activity.attendant)} ${getActionLabel(activity.actionType)}`;
}

export function shouldRenderActivityNarrative(actionType?: ActivityItem['actionType']) {
  return actionType !== 'note' && actionType !== 'register';
}

export function getActivityAccentClass(actionType?: string) {
  switch (actionType) {
    case 'close':
      return 'border-l-emerald-400';
    case 'forward':
      return 'border-l-violet-400';
    case 'edit':
      return 'border-l-violet-400';
    case 'register':
    case 'note':
    default:
      return 'border-l-blue-400';
  }
}

export function getActivityTintClass(actionType?: string) {
  switch (actionType) {
    case 'close':
      return 'bg-emerald-50/50';
    case 'forward':
    case 'edit':
      return 'bg-violet-50/45';
    case 'register':
    case 'note':
    default:
      return 'bg-blue-50/45';
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

export const TimelineActivity: React.FC<TimelineActivityProps> = ({ activities }) => {
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
          
          return (
            <div key={activity.id} data-testid={`timeline-activity-${activity.id}`} className="relative pl-20">
              {/* Ícone */}
              <div className="absolute left-0 top-0 w-16 h-16 flex items-center justify-center bg-white rounded-full border-4 border-white">
                <div className={`rounded-full p-1.5 ${getActivityTintClass(activity.actionType)}`}>
                  {getActionIcon(activity.actionType)}
                </div>
              </div>

              {/* Conteúdo */}
              <div className={`rounded-lg border border-l-2 border-slate-200 p-4 shadow-sm transition-shadow hover:shadow-md ${getActivityAccentClass(activity.actionType)} ${getActivityTintClass(activity.actionType)}`}>
                {/* Data e Hora */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-600">{date}</span>
                  <span className="text-xs text-slate-500">{time}</span>
                </div>

                {/* Eventos estruturais precisam do resumo; notas e apontamentos já têm conteúdo próprio. */}
                {shouldRenderActivityNarrative(activity.actionType) && (
                  <p className="mb-2 text-sm text-slate-700">
                    <span className="font-medium">{getActivitySummary(activity)}</span>
                  </p>
                )}

                {/* Descrição */}
                <div className="mb-2 rounded bg-white/80 p-3">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {activity.description}
                  </p>
                </div>

                {/* Nome do Atendente */}
                <div data-testid={`timeline-activity-author-${activity.id}`} className="flex items-center gap-2 text-xs text-slate-500">
                  <User className="w-3 h-3" />
                  <span>{getActivityAuthorName(activity.attendant)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
