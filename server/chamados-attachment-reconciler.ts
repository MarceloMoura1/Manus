import { ENV } from "./_core/env";
import { reconcileTicketAttachmentStates } from "./chamados-attachments";

type TicketAttachmentReconcileResult = { markedPendingDelete: number };
type TicketAttachmentReconcileLogger = Pick<Console, "info" | "error">;

export type TicketAttachmentReconcilerScheduler = {
  stop(): void;
};

export function startTicketAttachmentReconciler(options: {
  intervalMs?: number;
  logger?: TicketAttachmentReconcileLogger;
  reconcile?: () => Promise<TicketAttachmentReconcileResult>;
} = {}): TicketAttachmentReconcilerScheduler {
  const intervalMs = options.intervalMs ?? ENV.ticketAttachmentReconcileIntervalMs;
  const logger = options.logger ?? console;
  const reconcile = options.reconcile ?? reconcileTicketAttachmentStates;
  let inFlight = false;

  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await reconcile();
      if (result.markedPendingDelete > 0) {
        logger.info(`[Ticket Attachments] Marked ${result.markedPendingDelete} stale staged attachment(s) pending delete`);
      }
    } catch (error) {
      logger.error("[Ticket Attachments] Reconciliation failed", error);
    } finally {
      inFlight = false;
    }
  };

  // The state transition is idempotent and does not access Forge or remove blobs.
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
