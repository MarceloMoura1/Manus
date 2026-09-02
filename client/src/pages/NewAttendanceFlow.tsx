import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Phone,
  Search,
  Send,
  User,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  AudioRecordingController,
  browserAudioRecordingDependencies,
  type AudioRecordingPhase,
  type PreparedRecordedAudio,
} from '@/lib/audioRecordingController';
import {
  outboundAttachmentAccept,
  prepareOutboundAttachment,
  type PreparedOutboundAttachment,
} from '@/lib/outboundAttachment';
import type { CrmWhatsAppIntent } from '../../../shared/crm';
import { formatContactPhone, hasHumanContactName } from '../../../shared/contact-phone';

const ACTIVE_ATTENDANCE_PHONE_KEY = 'MEGADESK_ACTIVE_ATTENDANCE_PHONE';
const SELECTED_CONVERSATION_KEY = 'MEGADESK_SELECTED_CONVERSATION_ID';

export type NewAttendanceInitialCustomer = CrmWhatsAppIntent & {
  name: string;
  company: string;
  email?: string;
  customerType?: 'person' | 'company' | null;
};

type Recipient = {
  source: 'crm' | 'contact' | 'new';
  phone: string;
  contactId?: string;
  crmClientId?: string;
  customerType?: 'person' | 'company' | null;
  name?: string;
  company?: string;
  email?: string;
};

type ActiveConversation = { id: string; customerName: string; phone: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function NewAttendanceFlow({ onNavigate, initialPhone, initialCrmCustomer, embedded = false, onCancel }: {
  onNavigate?: (route: any) => void;
  initialPhone?: string;
  initialCrmCustomer?: NewAttendanceInitialCustomer;
  embedded?: boolean;
  onCancel?: () => void;
}) {
  const [search, setSearch] = useState(initialPhone ?? '');
  const [recipient, setRecipient] = useState<Recipient | null>(() => initialCrmCustomer ? {
    source: 'crm',
    phone: initialCrmCustomer.phone,
    crmClientId: initialCrmCustomer.crmClientId,
    customerType: initialCrmCustomer.customerType,
    name: initialCrmCustomer.name,
    company: initialCrmCustomer.company,
    email: initialCrmCustomer.email,
  } : null);
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<PreparedOutboundAttachment | null>(null);
  const [contactName, setContactName] = useState(initialCrmCustomer?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ActiveConversation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [audioRecordingPhase, setAudioRecordingPhase] = useState<AudioRecordingPhase>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const audioControllerRef = useRef<AudioRecordingController | null>(null);
  const sendRecordedAudioRef = useRef<(audio: PreparedRecordedAudio) => Promise<void>>(async () => undefined);
  const utils = trpc.useUtils();

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('megadesk_session_v1') || 'null'); } catch { return null; }
  }, []);
  const userEmail = typeof session?.userEmail === 'string' ? session.userEmail : '';
  const tenantId = typeof session?.clientId === 'string' ? session.clientId : 'pending-new-attendance';
  const lookupQuery = recipient?.phone ?? search;
  const recipientLookup = trpc.megadesk.attendanceRecipient.useQuery(
    { query: lookupQuery },
    { enabled: lookupQuery.trim().length >= 2, staleTime: 300 },
  );
  const createConversation = trpc.megadesk.createConversation.useMutation();
  const sendMessage = trpc.megadesk.sendMessage.useMutation();
  const sendAttachment = trpc.megadesk.sendAttachment.useMutation();

  useEffect(() => {
    const storedPhone = localStorage.getItem(ACTIVE_ATTENDANCE_PHONE_KEY);
    const phone = initialPhone || storedPhone;
    if (phone) setSearch(phone);
    if (storedPhone) localStorage.removeItem(ACTIVE_ATTENDANCE_PHONE_KEY);
  }, [initialPhone]);

  useEffect(() => () => audioControllerRef.current?.dispose(), []);

  const knownActive = activeConversation ?? recipientLookup.data?.activeConversation ?? null;
  const candidates = recipient ? [] : (recipientLookup.data?.candidates ?? []);
  const canUseTypedNumber = !recipient && !!recipientLookup.data?.canonicalPhone
    && !candidates.some((candidate: any) => candidate.recipientPhone === recipientLookup.data?.canonicalPhone);
  const isRecordingAudio = audioRecordingPhase === 'recording';
  const isAudioBusy = audioRecordingPhase === 'requesting_permission'
    || audioRecordingPhase === 'stopping'
    || audioRecordingPhase === 'processing'
    || audioRecordingPhase === 'sending';

  useEffect(() => {
    if (!isRecordingAudio) return;
    const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecordingAudio]);

  const clearRecipient = () => {
    audioControllerRef.current?.invalidate('Gravação cancelada porque o destinatário foi alterado.');
    setRecipient(null);
    setContactName('');
    setActiveConversation(null);
    setError(null);
  };

  const selectRecipient = (next: Recipient) => {
    audioControllerRef.current?.invalidate('Gravação cancelada porque o destinatário foi alterado.');
    setRecipient(next);
    setSearch(next.phone);
    setContactName(hasHumanContactName(next.name, next.phone) ? next.name!.trim() : '');
    setActiveConversation(null);
    setError(null);
  };

  const selectTypedNumber = () => {
    const phone = recipientLookup.data?.canonicalPhone;
    if (!phone) {
      setError('Informe um telefone com DDI e DDD válidos.');
      return;
    }
    selectRecipient({ source: 'new', phone });
  };

  const openExistingConversation = () => {
    if (!knownActive) return;
    localStorage.setItem(SELECTED_CONVERSATION_KEY, knownActive.id);
    onNavigate?.({ route: 'conversations', conversationId: knownActive.id });
  };

  const handleSend = async (recordedAudio?: PreparedOutboundAttachment) => {
    const attachmentToSend = recordedAudio ?? attachment;
    if (!recipient || (!message.trim() && !attachmentToSend) || isSubmitting) return;
    if (recipient.source === 'new' && !hasHumanContactName(contactName, recipient.phone)) {
      setError('Informe o nome do novo contato antes de enviar a primeira mensagem.');
      return;
    }
    if (knownActive) {
      setError('Já existe um atendimento ativo para este número. Abra o atendimento existente para continuar.');
      return;
    }
    if (!userEmail) {
      setError('Sua sessão não possui uma identidade válida para enviar mensagens. Entre novamente.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const text = message.trim();
    try {
        const conversation = await createConversation.mutateAsync({ phone: recipient.phone, contactName: contactName.trim() || undefined });
        if (conversation.existing) {
          setActiveConversation({ id: conversation.conversationId, customerName: recipient.name || 'Contato sem nome', phone: recipient.phone });
        setError('Já existe um atendimento ativo para este número. Nenhuma nova conversa foi criada.');
        return;
      }

      try {
        if (attachmentToSend) {
          await sendAttachment.mutateAsync({
            conversationId: conversation.conversationId,
            kind: attachmentToSend.kind,
            dataUrl: attachmentToSend.dataUrl,
            mimeType: attachmentToSend.mimeType,
            fileName: attachmentToSend.fileName,
            caption: text || undefined,
            userEmail,
            clientAttemptId: crypto.randomUUID(),
          });
        } else {
          await sendMessage.mutateAsync({
            conversationId: conversation.conversationId,
            message: text,
            userEmail,
            clientAttemptId: crypto.randomUUID(),
          });
        }
      } catch (sendError) {
          setActiveConversation({ id: conversation.conversationId, customerName: recipient.name || 'Contato sem nome', phone: recipient.phone });
        setError(errorMessage(sendError, 'O atendimento foi criado, mas a mensagem não pôde ser enviada.'));
        return;
      }

      setMessage('');
      setAttachment(null);
      await Promise.all([utils.conversations.list.invalidate(), utils.conversations.counts.invalidate()]);
      localStorage.setItem(SELECTED_CONVERSATION_KEY, conversation.conversationId);
      onNavigate?.({ route: 'conversations', conversationId: conversation.conversationId });
    } catch (createError) {
      setError(errorMessage(createError, 'Não foi possível iniciar o atendimento.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  sendRecordedAudioRef.current = async audio => {
    await handleSend({
      kind: 'audio',
      dataUrl: audio.dataUrl,
      mimeType: audio.mimeType,
      fileName: audio.fileName,
    });
  };

  const getAudioController = () => {
    if (!audioControllerRef.current) {
      audioControllerRef.current = new AudioRecordingController(browserAudioRecordingDependencies(), {
        onPhaseChange: setAudioRecordingPhase,
        onNotice: (notice, type) => { if (type === 'error') setError(notice); },
        onSend: audio => sendRecordedAudioRef.current(audio),
      });
    }
    return audioControllerRef.current;
  };

  const startAudioRecording = async () => {
    if (!recipient || knownActive || isSubmitting || isAudioBusy || isRecordingAudio) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Gravação de áudio não é suportada neste navegador.');
      return;
    }
    if (!userEmail) {
      setError('Sua sessão não possui uma identidade válida para enviar mensagens. Entre novamente.');
      return;
    }
    setAttachment(null);
    setRecordingSeconds(0);
    await getAudioController().start({
      tenantId,
      conversationId: 'pending-new-attendance',
      userEmail,
    });
  };

  const recipientLabel = recipient?.name || recipient?.company || (recipient ? formatContactPhone(recipient.phone) : '');
  const requiresContactName = recipient?.source === 'new' && !hasHumanContactName(contactName, recipient.phone);
  const composerDisabled = !recipient || !!knownActive || !!requiresContactName || isSubmitting || isAudioBusy || isRecordingAudio;

  return (
    <section className={cn('flex min-h-0 h-full w-full flex-col overflow-hidden bg-white text-slate-900', !embedded && 'min-h-screen')} data-testid="new-attendance-flow">
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={onCancel} aria-label="Voltar para atendimentos" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0"><h2 className="truncate text-base font-bold sm:text-lg">Novo atendimento</h2><p className="hidden text-xs text-slate-500 sm:block">Escolha o destinatário e envie a primeira mensagem.</p></div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fechar novo atendimento" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {error && <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /><p>{error}</p></div>}

          <div className="space-y-2">
            <label htmlFor="attendance-recipient" className="text-sm font-semibold text-slate-800">Para</label>
            {recipient ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><Phone className="h-4 w-4 flex-shrink-0 text-blue-600" /><span className="truncate text-sm font-medium text-slate-800">{recipientLabel}</span></div><button type="button" onClick={clearRecipient} className="text-xs font-semibold text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Alterar</button></div>
            ) : (
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="attendance-recipient" value={search} onChange={(event) => { setSearch(event.target.value); setActiveConversation(null); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter' && canUseTypedNumber) { event.preventDefault(); selectTypedNumber(); } }} placeholder="Buscar cliente, contato ou número..." autoComplete="tel" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />{recipientLookup.isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-500" aria-label="Buscando destinatário" />}</div>
            )}
          </div>

          {!recipient && search.trim() && <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="region" aria-label="Resultados de destinatários">
            {candidates.map((candidate: any) => {
              const phone = candidate.recipientPhone || candidate.whatsapp || candidate.phone;
              if (!phone) return null;
              const isCrm = candidate.source === 'crm';
              const name = isCrm ? (candidate.responsibleName || candidate.companyName) : candidate.displayName;
              return <button key={candidate.crmClientId || candidate.contactId} type="button" onClick={() => selectRecipient(isCrm ? { source: 'crm', phone, crmClientId: candidate.crmClientId, customerType: candidate.customerType, name, company: candidate.companyName, email: candidate.email || undefined } : { source: 'contact', phone, contactId: candidate.contactId, name: candidate.displayName })} className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left transition last:border-b-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><div className="rounded-lg bg-blue-100 p-2 text-blue-700"><User className="h-4 w-4" /></div><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{hasHumanContactName(name, phone) ? name : 'Contato sem nome'}</span><span className="block truncate text-xs text-slate-500">{isCrm ? `${candidate.customerType === 'company' ? 'Empresa' : 'Pessoa física'} · ` : 'Contato · '}{formatContactPhone(phone)}</span></span><ChevronRight className="h-4 w-4 text-slate-400" /></button>;
            })}
            {canUseTypedNumber && <button type="button" onClick={selectTypedNumber} className="flex w-full items-center gap-3 bg-blue-50 px-3 py-3 text-left text-blue-800 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><div className="rounded-lg bg-white p-2 text-blue-700"><Phone className="h-4 w-4" /></div><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Usar este número</span><span className="block truncate text-xs">+{recipientLookup.data?.canonicalPhone}</span></span><ChevronRight className="h-4 w-4" /></button>}
            {!recipientLookup.isFetching && !candidates.length && !canUseTypedNumber && <p className="px-3 py-3 text-sm text-slate-500">Digite um nome ou um telefone com DDI e DDD válidos.</p>}
          </div>}

          {recipient && <div className="mt-5 space-y-4">
            {recipient.source === 'crm' ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-700 p-4 text-white shadow-sm" data-testid="existing-customer-card">
                <div className="mb-4 flex items-center justify-between gap-3"><span className="text-sm font-semibold">Dados do cliente</span><span className="rounded-full border border-blue-300 bg-blue-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">{recipient.customerType === 'company' ? 'Empresa' : 'Pessoa física'}</span></div>
                {recipient.customerType === 'company' ? <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-blue-100">Empresa / nome fantasia</p><p className="mt-0.5 break-words text-sm font-semibold">{recipient.company || '—'}</p></div>{recipient.name && <div><p className="text-xs text-blue-100">Contato principal</p><p className="mt-0.5 break-words text-sm font-semibold">{recipient.name}</p></div>}<div><p className="text-xs text-blue-100">Telefone</p><p className="mt-0.5 break-all text-sm font-semibold">{formatContactPhone(recipient.phone)}</p></div>{recipient.email && <div><p className="text-xs text-blue-100">E-mail</p><p className="mt-0.5 break-all text-sm font-semibold">{recipient.email}</p></div>}</div> : <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-blue-100">Nome</p><p className="mt-0.5 break-words text-sm font-semibold">{recipient.name || recipient.company || '—'}</p></div><div><p className="text-xs text-blue-100">Telefone</p><p className="mt-0.5 break-all text-sm font-semibold">{formatContactPhone(recipient.phone)}</p></div>{recipient.email && <div><p className="text-xs text-blue-100">E-mail</p><p className="mt-0.5 break-all text-sm font-semibold">{recipient.email}</p></div>}</div>}
                <button type="button" onClick={() => onNavigate?.({ route: 'erp-clients', crmClientId: recipient.crmClientId })} className="mt-4 rounded-xl border border-blue-300 bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500">Visualizar perfil</button>
              </div>
            ) : recipient.source === 'contact' ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="lightweight-contact-card"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Contato</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Nome</p><p className="mt-0.5 text-sm font-semibold text-slate-800">{hasHumanContactName(recipient.name, recipient.phone) ? recipient.name : 'Contato sem nome'}</p></div><div><p className="text-xs text-slate-500">Telefone</p><p className="mt-0.5 text-sm font-semibold text-slate-800">{formatContactPhone(recipient.phone)}</p></div></div></div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="new-contact-card"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Novo contato</p><div className="mt-3 grid gap-3"><div><p className="text-xs text-slate-500">Telefone</p><p className="mt-0.5 text-sm font-semibold text-slate-800">{formatContactPhone(recipient.phone)}</p></div><label className="block text-sm font-medium text-slate-700" htmlFor="attendance-contact-name">Nome<input id="attendance-contact-name" value={contactName} onChange={event => { setContactName(event.target.value); setError(null); }} required maxLength={180} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>{requiresContactName && <p className="text-xs text-slate-500">Informe o nome para continuar e enviar a primeira mensagem.</p>}</div></div>
            )}

            {knownActive && <div className="rounded-2xl border border-blue-300 bg-white p-4 shadow-sm" role="status" data-testid="active-attendance-warning"><div className="flex items-start gap-3"><div className="rounded-xl bg-blue-100 p-2 text-blue-700"><AlertCircle className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Atendimento em andamento</p><h3 className="mt-1 font-semibold text-slate-950">Este número já possui uma conversa ativa.</h3><p className="mt-1 text-sm text-slate-600">Para evitar duplicidade, uma nova conversa não será criada.</p></div></div><button type="button" onClick={openExistingConversation} className="mt-4 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Abrir atendimento</button></div>}
          </div>}
        </div>

        <div className="border-t border-slate-100 bg-white p-3 sm:p-4" data-testid="new-attendance-message-composer">
          {attachment && <div className="mb-3 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">{attachment.kind === 'image' || attachment.kind === 'sticker' ? <img src={attachment.dataUrl} alt="Prévia" className="h-12 w-12 rounded-lg object-contain" /> : attachment.kind === 'video' ? <Video className="h-7 w-7 text-blue-700" /> : attachment.kind === 'audio' ? <Mic className="h-7 w-7 text-blue-700" /> : <FileText className="h-7 w-7 text-blue-700" />}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-700">{attachment.fileName}</p><p className="text-xs text-slate-500">Adicione uma legenda e envie a primeira mensagem</p></div><button type="button" onClick={() => setAttachment(null)} aria-label="Remover anexo" className="rounded-full p-1 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button></div>}
          <input ref={attachmentInputRef} type="file" className="hidden" accept={outboundAttachmentAccept} onChange={(event) => { const file = event.target.files?.[0]; if (file) { void prepareOutboundAttachment(file).then(setAttachment).catch(attachmentError => setError(errorMessage(attachmentError, 'Não foi possível ler o arquivo.'))); } event.currentTarget.value = ''; }} />
          <label htmlFor="attendance-message" className="sr-only">Mensagem</label>
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 sm:flex-nowrap"><button type="button" title="Adicionar anexo" disabled={composerDisabled} onClick={() => attachmentInputRef.current?.click()} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><Paperclip className="h-5 w-5" /></button>{isRecordingAudio ? <div className="flex items-center gap-2" role="group" aria-label="Controles da gravação de áudio"><button type="button" title="Cancelar gravação" aria-label="Cancelar gravação" onClick={() => audioControllerRef.current?.decide('cancel')} className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600"><X className="h-5 w-5" /></button><div className="flex h-11 min-w-20 items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 text-red-600" role="status" aria-label={`Gravando áudio há ${recordingSeconds} segundos`}><Mic className="h-5 w-5 animate-pulse" /><span className="text-xs font-semibold">{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span></div><button type="button" title="Enviar áudio" aria-label="Enviar áudio" onClick={() => audioControllerRef.current?.decide('send')} className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><Send className="h-5 w-5" /></button></div> : isAudioBusy ? <div className="flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700" role="status"><Mic className="h-5 w-5" />{audioRecordingPhase === 'requesting_permission' ? 'Aguardando microfone…' : audioRecordingPhase === 'sending' ? 'Enviando áudio…' : 'Finalizando áudio…'}</div> : <button type="button" title="Gravar áudio" aria-label="Gravar áudio" disabled={composerDisabled} onClick={() => { void startAudioRecording(); }} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><Mic className="h-5 w-5" /></button>}<textarea id="attendance-message" value={message} disabled={composerDisabled} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} placeholder={recipient ? 'Digite uma mensagem...' : 'Selecione um destinatário para escrever...'} rows={1} className="max-h-32 min-h-11 min-w-0 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" /><button type="button" onClick={() => { void handleSend(); }} disabled={composerDisabled || (!message.trim() && !attachment)} aria-label="Enviar mensagem" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div>
          <p className="mt-2 text-xs text-slate-400">{requiresContactName ? 'Informe o nome do novo contato para habilitar o envio.' : recipient ? 'Enter envia · Shift + Enter quebra a linha' : 'Informe um número, depois o nome do novo contato e a mensagem.'}</p>
        </div>
      </div>
    </section>
  );
}
