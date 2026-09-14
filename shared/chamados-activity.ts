export const legacyTicketActivityTypes = [
  "register",
  "edit",
  "close",
  "forward",
  "note",
  "attachment",
] as const;

export const structuredTicketActivityTypes = [
  "ticket_created",
  "manual_activity",
  "status_changed",
  "collaborator_added",
  "collaborator_removed",
  "ticket_edited",
  "ticket_forwarded",
  "attachment_added",
  "attachment_removed",
] as const;

export const ticketActivityTypes = [
  ...legacyTicketActivityTypes,
  ...structuredTicketActivityTypes,
] as const;

export type LegacyTicketActivityType = (typeof legacyTicketActivityTypes)[number];
export type StructuredTicketActivityType = (typeof structuredTicketActivityTypes)[number];
export type TicketActivityType = (typeof ticketActivityTypes)[number];

export type TicketFieldChange = {
  field: "customer" | "title" | "observations" | "priority";
  from: string | null;
  to: string | null;
  fromId?: string | null;
  toId?: string | null;
};

export type TicketActivityMetadata =
  | { eventType: "ticket_created" }
  | { eventType: "manual_activity" }
  | { eventType: "status_changed"; fromStatus: string; toStatus: string }
  | {
      eventType: "collaborator_added" | "collaborator_removed";
      collaboratorId: string;
      collaboratorName: string;
    }
  | { eventType: "ticket_edited"; changes: TicketFieldChange[] }
  | {
      eventType: "ticket_forwarded";
      fromAssigneeId?: string | null;
      fromAssigneeName?: string | null;
      toAssigneeId: string;
      toAssigneeName: string;
      observation?: string;
    }
  | {
      eventType: "attachment_added";
      attachmentId: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256?: string;
    }
  | {
      eventType: "attachment_removed";
      attachmentId: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256?: string;
    };

const string = (value: unknown, max = 2_000): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

const nullableString = (value: unknown, max = 2_000): string | null | undefined =>
  value === null || value === undefined ? value : string(value, max);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Treat persisted metadata as untrusted at the rendering boundary. Legacy rows
 * intentionally return null rather than being coerced into a guessed event.
 */
export function parseTicketActivityMetadata(
  actionType: string | null | undefined,
  raw: unknown,
): TicketActivityMetadata | null {
  if (!isRecord(raw) || typeof raw.eventType !== "string") return null;
  const eventType = raw.eventType;
  if (actionType && eventType !== actionType) return null;

  if (eventType === "ticket_created" || eventType === "manual_activity") {
    return { eventType };
  }
  if (eventType === "status_changed") {
    const fromStatus = string(raw.fromStatus, 40);
    const toStatus = string(raw.toStatus, 40);
    return fromStatus && toStatus ? { eventType, fromStatus, toStatus } : null;
  }
  if (eventType === "collaborator_added" || eventType === "collaborator_removed") {
    const collaboratorId = string(raw.collaboratorId, 80);
    const collaboratorName = string(raw.collaboratorName, 180);
    return collaboratorId && collaboratorName ? { eventType, collaboratorId, collaboratorName } : null;
  }
  if (eventType === "ticket_edited") {
    if (!Array.isArray(raw.changes) || raw.changes.length === 0 || raw.changes.length > 4) return null;
    const changes: TicketFieldChange[] = [];
    for (const change of raw.changes) {
      if (!isRecord(change)) return null;
      if (change.field !== "customer" && change.field !== "title" && change.field !== "observations" && change.field !== "priority") return null;
      const from = nullableString(change.from, 2_000);
      const to = nullableString(change.to, 2_000);
      const fromId = nullableString(change.fromId, 80);
      const toId = nullableString(change.toId, 80);
      if (from === undefined || to === undefined) return null;
      changes.push({ field: change.field, from, to, ...(fromId != null ? { fromId } : {}), ...(toId != null ? { toId } : {}) });
    }
    return { eventType, changes };
  }
  if (eventType === "ticket_forwarded") {
    const toAssigneeId = string(raw.toAssigneeId, 80);
    const toAssigneeName = string(raw.toAssigneeName, 180);
    const fromAssigneeId = nullableString(raw.fromAssigneeId, 80);
    const fromAssigneeName = nullableString(raw.fromAssigneeName, 180);
    const observation = nullableString(raw.observation, 2_000);
    if (!toAssigneeId || !toAssigneeName) return null;
    return {
      eventType,
      toAssigneeId,
      toAssigneeName,
      ...(fromAssigneeId !== null ? { fromAssigneeId } : {}),
      ...(fromAssigneeName !== null ? { fromAssigneeName } : {}),
      ...(observation ? { observation } : {}),
    };
  }
  if (eventType === "attachment_added" || eventType === "attachment_removed") {
    const attachmentId = string(raw.attachmentId, 80);
    const fileName = string(raw.fileName, 255);
    const mimeType = string(raw.mimeType, 100);
    const size = typeof raw.size === "number" && Number.isInteger(raw.size) && raw.size >= 0 && raw.size <= 12 * 1024 * 1024
      ? raw.size
      : null;
    const sha256 = nullableString(raw.sha256, 64);
    if (!attachmentId || !fileName || !mimeType || size === null || sha256 === undefined) return null;
    return { eventType, attachmentId, fileName, mimeType, size, ...(sha256 ? { sha256 } : {}) };
  }
  return null;
}
