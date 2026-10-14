import type { StrictJsonRecord } from "./strict-json";

/** Data contracts for synthetic receipt fixtures. They deliberately carry no
 * verification API: structural validation is private to the authenticated
 * receipt verifier in attestation.ts. */
export const SYNTHETIC_JOURNAL_KIND = "megadesk-runtime-trust-synthetic-journal";
export const SYNTHETIC_JOURNAL_VERSION = 1;

export interface SyntheticJournalContext {
  receiptId: string;
  operationId: string;
  authorizationId: string;
}

export interface SyntheticJournalEvent {
  sequence: number;
  eventType: string;
  occurredAt: string;
  evidence: StrictJsonRecord;
  previousChecksum: string | null;
  checksum: string;
}

/** A synthetic journal is not cryptographically authenticated. Only
 * VerifiedReceiptJournal from verifyHistoricalReceiptJournalBytes has that
 * association with a receipt and independently signed time evidence. */
export interface SyntheticJournal extends SyntheticJournalContext {
  kind: typeof SYNTHETIC_JOURNAL_KIND;
  version: typeof SYNTHETIC_JOURNAL_VERSION;
  events: SyntheticJournalEvent[];
  checksum: string;
}
