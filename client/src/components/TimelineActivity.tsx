import React from 'react';
import { CheckCircle, Edit, Users, Share2, MessageSquare, User } from 'lucide-react';

export interface ActivityItem {
  id: string;
  date: Date | number | string; // Date, timestamp em millisegundos ou string ISO
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
      return <Edit className="w-6 h-6 text-blue-500" />;
    case 'forward':
      return <Share2 className="w-6 h-6 text-purple-500" />;
    case 'register':
      return <User className="w-6 h-6 text-slate-500" />;
    case 'note':
    default:
      return <MessageSquare className="w-6 h-6 text-slate-400" />;
  }
};

const getActionLabel = (actionType?: string) => {
  switch (actionType) {
    case 'close':
      return 'Atendente encerrou o chamado.';
    case 'edit':
      return 'Atendente editou o chamado.';
    case 'forward':
      return 'Atendente encaminhou o chamado.';
    case 'register':
      return 'Atendente registrou um apontamento.';
    case 'note':
    default:
      return 'Atendente registrou uma nota.';
  }
};

const formatDateTime = (date: Date | number) => {
  let d: Date;
  
  if (typeof date === 'number') {
    d = new Date(date);
  } else if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'string') {
    d = new Date(date);
  } else {
    d = new Date();
  }
  
  if (isNaN(d.getTime())) {
    return {
      date: 'Data inválida',
      time: '--:--',
    };
  }
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return {
    date: `${day}/${month}/${year}`,
    time: `${hours}:${minutes}`,
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
            <div key={activity.id} className="relative pl-20">
              {/* Ícone */}
              <div className="absolute left-0 top-0 w-16 h-16 flex items-center justify-center bg-white rounded-full border-4 border-white">
                <div className="p-1.5 bg-slate-50 rounded-full">
                  {getActionIcon(activity.actionType)}
                </div>
              </div>

              {/* Conteúdo */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                {/* Data e Hora */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-600">{date}</span>
                  <span className="text-xs text-slate-500">{time}</span>
                </div>

                {/* Tipo de Ação */}
                <p className="text-sm text-slate-700 mb-2">
                  <span className="font-medium">Atendente {activity.attendant}</span> {getActionLabel(activity.actionType).split('Atendente')[1]}
                </p>

                {/* Descrição */}
                <div className="bg-slate-50 rounded p-3 mb-2">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {activity.description}
                  </p>
                </div>

                {/* Nome do Atendente */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <User className="w-3 h-3" />
                  <span>{activity.attendant}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
