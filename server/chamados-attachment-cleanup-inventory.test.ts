import { describe, expect, it, vi } from "vitest";
import {
  inventoryEligibleTicketAttachmentPhysicalCleanup,
  reconcileTicketAttachmentStates,
  TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION,
} from "./chamados-attachments";
import { markTicketAttachmentPendingDelete } from "./chamados-domain";

type SyntheticAttachment = {
  attachmentId: string;
  clientId: string;
  chamadoId: string;
  state: "staged" | "active" | "pending_delete" | "deleted";
  cleanupLifecycleVersion: number | null;
  physicalCleanupEligibleAt: string | null;
  physicalObjectPresent: boolean;
};

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const chamadoA = "11111111-1111-4111-8111-111111111111";
const chamadoB = "22222222-2222-4222-8222-222222222222";
const oldMarker = "2020-01-01T00:00:00.000Z";

function candidatePool(rows: SyntheticAttachment[]) {
  return {
    execute: vi.fn(async (query: string, values: unknown[]) => {
      expect(query).toContain("client_id=? AND chamado_id=?");
      expect(query).toContain("attachment_state='pending_delete'");
      expect(query).toContain(`cleanup_lifecycle_version=${TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION}`);
      expect(query).toContain("physical_cleanup_eligible_at IS NOT NULL");
      expect(query).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/i);
      expect(query).not.toContain("storage_key");
      const [clientId, chamadoId] = values;
      return [rows.filter(row =>
        row.clientId === clientId
        && row.chamadoId === chamadoId
        && row.state === "pending_delete"
        && row.cleanupLifecycleVersion === TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION
        && row.physicalCleanupEligibleAt != null,
      ), []];
    }),
  };
}

function reconcilePool(row: SyntheticAttachment) {
  const execute = vi.fn(async (query: string) => {
    expect(query).toContain(`cleanup_lifecycle_version=${TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION}`);
    const eligibleForTransition = row.state === "staged"
      && row.cleanupLifecycleVersion === TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION;
    if (eligibleForTransition) {
      row.state = "pending_delete";
      row.physicalCleanupEligibleAt = "set-by-reconciler";
    }
    return [{ affectedRows: eligibleForTransition ? 1 : 0 }, []];
  });
  return { execute, row };
}

describe("ticket attachment physical-cleanup inventory", () => {
  it("records the pre-fix finding: a legacy stale staged row had no provenance guard", () => {
    const legacyStaleStaged = { state: "staged", cleanupLifecycleVersion: null };
    expect(legacyStaleStaged.state === "staged" && legacyStaleStaged.cleanupLifecycleVersion == null).toBe(true);
  });

  it("never lets the reconciler grant cleanup provenance to a legacy stale staged row", async () => {
    const controlled = reconcilePool({
      attachmentId: "legacy-staged", clientId: tenantA, chamadoId: chamadoA,
      state: "staged", cleanupLifecycleVersion: null,
      physicalCleanupEligibleAt: null, physicalObjectPresent: true,
    });
    await expect(reconcileTicketAttachmentStates(60_000, controlled as any))
      .resolves.toEqual({ markedPendingDelete: 0 });
    expect(controlled.row).toMatchObject({ state: "staged", physicalCleanupEligibleAt: null });
  });

  it("marks only proven new staged reservations when interruption recovery is needed", async () => {
    const reservationInterrupted = reconcilePool({
      attachmentId: "new-staged", clientId: tenantA, chamadoId: chamadoA,
      state: "staged", cleanupLifecycleVersion: TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION,
      physicalCleanupEligibleAt: null, physicalObjectPresent: false,
    });
    await expect(reconcileTicketAttachmentStates(60_000, reservationInterrupted as any))
      .resolves.toEqual({ markedPendingDelete: 1 });
    expect(reservationInterrupted.row).toMatchObject({
      state: "pending_delete", physicalCleanupEligibleAt: "set-by-reconciler",
    });

    const afterPhysicalWriteInterrupted = {
      state: "staged" as "staged" | "pending_delete",
      cleanupLifecycleVersion: TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION,
      physicalCleanupEligibleAt: null as string | null,
    };
    const execute = vi.fn(async (query: string) => {
      expect(query).toContain("cleanup_lifecycle_version=1");
      afterPhysicalWriteInterrupted.state = "pending_delete";
      afterPhysicalWriteInterrupted.physicalCleanupEligibleAt = "set-by-pending-transition";
      return [{ affectedRows: 1 }, []];
    });
    await markTicketAttachmentPendingDelete("new-after-write", tenantA, { execute } as any);
    expect(afterPhysicalWriteInterrupted).toMatchObject({
      state: "pending_delete", physicalCleanupEligibleAt: "set-by-pending-transition",
    });
  });

  it("selects only proven pending metadata in the requested tenant and chamado", async () => {
    const matrix: SyntheticAttachment[] = [
      { attachmentId: "legacy-staged", clientId: tenantA, chamadoId: chamadoA, state: "staged", cleanupLifecycleVersion: null, physicalCleanupEligibleAt: null, physicalObjectPresent: true },
      { attachmentId: "legacy-pending", clientId: tenantA, chamadoId: chamadoA, state: "pending_delete", cleanupLifecycleVersion: null, physicalCleanupEligibleAt: null, physicalObjectPresent: true },
      { attachmentId: "new-staged", clientId: tenantA, chamadoId: chamadoA, state: "staged", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: null, physicalObjectPresent: false },
      { attachmentId: "new-pending", clientId: tenantA, chamadoId: chamadoA, state: "pending_delete", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: true },
      { attachmentId: "active", clientId: tenantA, chamadoId: chamadoA, state: "active", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: true },
      { attachmentId: "deleted", clientId: tenantA, chamadoId: chamadoA, state: "deleted", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: true },
      { attachmentId: "missing-object", clientId: tenantA, chamadoId: chamadoA, state: "pending_delete", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: false },
      { attachmentId: "other-resource", clientId: tenantA, chamadoId: chamadoB, state: "pending_delete", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: true },
      { attachmentId: "other-tenant", clientId: tenantB, chamadoId: chamadoA, state: "pending_delete", cleanupLifecycleVersion: 1, physicalCleanupEligibleAt: oldMarker, physicalObjectPresent: true },
    ];
    const pool = candidatePool(matrix);

    await expect(inventoryEligibleTicketAttachmentPhysicalCleanup({
      clientId: tenantA, chamadoId: chamadoA, olderThanMs: 60_000, limit: 10, pool: pool as any,
    })).resolves.toEqual({ candidates: 2 });
    await expect(inventoryEligibleTicketAttachmentPhysicalCleanup({
      clientId: tenantA, chamadoId: chamadoB, olderThanMs: 60_000, limit: 10, pool: pool as any,
    })).resolves.toEqual({ candidates: 1 });
    await expect(inventoryEligibleTicketAttachmentPhysicalCleanup({
      clientId: tenantB, chamadoId: chamadoA, olderThanMs: 60_000, limit: 10, pool: pool as any,
    })).resolves.toEqual({ candidates: 1 });

    expect(matrix.find(row => row.attachmentId === "missing-object")).toMatchObject({ physicalObjectPresent: false });
    expect(pool.execute).toHaveBeenCalledTimes(3);
  });

  it("fails closed instead of broadening to a global candidate inventory", async () => {
    const execute = vi.fn();
    await expect(inventoryEligibleTicketAttachmentPhysicalCleanup({
      clientId: "", chamadoId: chamadoA, pool: { execute } as any,
    })).rejects.toThrow("TICKET_ATTACHMENT_CLEANUP_SCOPE_REQUIRED");
    await expect(inventoryEligibleTicketAttachmentPhysicalCleanup({
      clientId: tenantA, chamadoId: "", pool: { execute } as any,
    })).rejects.toThrow("TICKET_ATTACHMENT_CLEANUP_SCOPE_REQUIRED");
    expect(execute).not.toHaveBeenCalled();
  });
});
