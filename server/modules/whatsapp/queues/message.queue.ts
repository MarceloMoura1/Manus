/**
 * WhatsApp Module — Message Queue
 * Fila de processamento de mensagens em memória.
 * Arquitetura preparada para migração futura para Redis/BullMQ.
 *
 * Para migrar para Redis/BullMQ:
 * 1. Instalar: pnpm add bullmq ioredis
 * 2. Substituir InMemoryQueue por Queue do BullMQ
 * 3. Mover workers para arquivos separados
 */

export type QueueJobType = "send_message" | "process_webhook" | "sync_status";

export interface QueueJob<T = unknown> {
  id: string;
  type: QueueJobType;
  payload: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledAt?: Date;
}

type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;

class InMemoryQueue {
  private queue: QueueJob[] = [];
  private handlers = new Map<QueueJobType, JobHandler>();
  private processing = false;
  private readonly maxRetryDelay = 30_000; // 30s

  /**
   * Registra um handler para um tipo de job.
   */
  register<T>(type: QueueJobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Adiciona um job à fila.
   */
  enqueue<T>(type: QueueJobType, payload: T, opts: { maxAttempts?: number; delayMs?: number } = {}): string {
    const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: QueueJob<T> = {
      id,
      type,
      payload,
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 3,
      createdAt: new Date(),
      scheduledAt: opts.delayMs ? new Date(Date.now() + opts.delayMs) : undefined,
    };

    this.queue.push(job as QueueJob);
    this.tick();
    return id;
  }

  /**
   * Processa a fila de forma sequencial.
   */
  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = new Date();
      const jobIndex = this.queue.findIndex(
        (j) => !j.scheduledAt || j.scheduledAt <= now
      );

      if (jobIndex === -1) {
        // Todos os jobs estão agendados para o futuro
        const nextJob = this.queue.reduce((a, b) =>
          (a.scheduledAt?.getTime() ?? 0) < (b.scheduledAt?.getTime() ?? 0) ? a : b
        );
        const delay = (nextJob.scheduledAt?.getTime() ?? 0) - Date.now();
        await sleep(Math.max(delay, 100));
        continue;
      }

      const job = this.queue.splice(jobIndex, 1)[0];
      const handler = this.handlers.get(job.type);

      if (!handler) {
        console.warn(`[WA Queue] Sem handler para job type: ${job.type}`);
        continue;
      }

      job.attempts++;

      try {
        await handler(job);
      } catch (err) {
        console.error(`[WA Queue] Job ${job.id} falhou (tentativa ${job.attempts}/${job.maxAttempts}):`, err);

        if (job.attempts < job.maxAttempts) {
          // Retry com backoff exponencial
          const delay = Math.min(1000 * Math.pow(2, job.attempts), this.maxRetryDelay);
          job.scheduledAt = new Date(Date.now() + delay);
          this.queue.push(job);
        } else {
          console.error(`[WA Queue] Job ${job.id} descartado após ${job.maxAttempts} tentativas`);
        }
      }
    }

    this.processing = false;
  }

  /**
   * Retorna o tamanho atual da fila.
   */
  size(): number {
    return this.queue.length;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton — uma fila por processo
export const messageQueue = new InMemoryQueue();

// ─── Tipos de payload por job ──────────────────────────────────────────────────

export interface SendMessageJobPayload {
  clientId: string;
  conversationId: string;
  messageId: string; // ID da mensagem já salva no banco
  accountId: string;
  to: string;
  type: string;
  content: string;
  mediaUrl?: string;
}

export interface WebhookJobPayload {
  phoneNumberId: string;
  rawPayload: unknown;
}
