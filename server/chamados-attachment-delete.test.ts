import { describe, expect, it } from "vitest";
import { logicallyRemoveTicketAttachment, reserveTicketAttachment } from "./chamados-domain";

const input = {
  attachmentId: "22222222-2222-4222-8222-222222222222",
  chamadoId: "11111111-1111-4111-8111-111111111111",
  clientId: "tenant-a",
  actor: { userId: "operator-a", userName: "Operador A" },
};

function controlledPool(
  state: "active" | "pending_delete" | "legacy" = "active",
  cleanupLifecycleVersion: number | null = 1,
) {
  let attachmentState = state;
  let pendingDeleteAt: string | null = null;
  let cleanupEligible = false;
  let events = 0;
  let committed = false;
  const connection = {
    beginTransaction: async () => undefined,
    commit: async () => { committed = true; },
    rollback: async () => undefined,
    release: () => undefined,
    execute: async (query: string) => {
      if (query.includes("FROM megadesk_domain_chamados")) return [[{ chamadoId: input.chamadoId, clientId: input.clientId }], []];
      if (query.includes("FROM megadesk_domain_chamado_attachments")) {
        return [[{ state: attachmentState, fileName: "evidence.txt", mimeType: "text/plain", fileSize: 17, sha256: "a".repeat(64), cleanupLifecycleVersion }], []];
      }
      if (query.includes("SET attachment_state='pending_delete'")) {
        if (attachmentState !== "active") return [{ affectedRows: 0 }, []];
        attachmentState = "pending_delete";
        pendingDeleteAt = "set";
        cleanupEligible = cleanupLifecycleVersion === 1 && query.includes("cleanup_lifecycle_version=1");
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes("INSERT INTO megadesk_domain_chamado_activities")) { events += 1; return [{ affectedRows: 1 }, []]; }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  return { pool: { getConnection: async () => connection } as any, state: () => ({ attachmentState, pendingDeleteAt, cleanupEligible, events, committed }) };
}

describe("logical ticket attachment removal", () => {
  it("writes cleanup lifecycle provenance only with a new attachment reservation", async () => {
    let insertedWithCurrentLifecycle = false;
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      execute: async (query: string) => {
        if (query.includes("FROM megadesk_domain_chamados")) return [[{ chamadoId: input.chamadoId, clientId: input.clientId }], []];
        if (query.includes("INSERT INTO megadesk_domain_chamado_attachments")) {
          insertedWithCurrentLifecycle = query.includes("cleanup_lifecycle_version") && query.includes("NOW(), 1");
          return [{ affectedRows: 1 }, []];
        }
        if (query.includes("SELECT attachment_id AS attachmentId")) {
          return [[{ attachmentId: input.attachmentId, storageKey: "ticket-attachments/tenant-a/object", state: "staged", chamadoId: input.chamadoId, clientId: input.clientId, sha256: "a".repeat(64) }], []];
        }
        throw new Error(`Unexpected SQL: ${query}`);
      },
    };
    const reservation = await reserveTicketAttachment({
      chamadoId: input.chamadoId, clientId: input.clientId, actor: input.actor,
      clientAttemptId: "33333333-3333-4333-8333-333333333333", fileName: "evidence.txt",
      fileSize: 17, mimeType: "text/plain", sha256: "a".repeat(64), storageKey: "ticket-attachments/tenant-a/object",
    }, { getConnection: async () => connection } as any);
    expect(reservation).toMatchObject({ state: "staged", existingActive: false });
    expect(insertedWithCurrentLifecycle).toBe(true);
  });

  it("moves an active attachment once, timestamps it and writes one audited event", async () => {
    const controlled = controlledPool();
    await expect(logicallyRemoveTicketAttachment(input, controlled.pool)).resolves.toEqual({ logicallyRemoved: true, state: "pending_delete", reused: false });
    expect(controlled.state()).toEqual({ attachmentState: "pending_delete", pendingDeleteAt: "set", cleanupEligible: true, events: 1, committed: true });
  });

  it("is idempotent after a lost response and does not duplicate the timeline event", async () => {
    const controlled = controlledPool();
    await logicallyRemoveTicketAttachment(input, controlled.pool);
    await expect(logicallyRemoveTicketAttachment(input, controlled.pool)).resolves.toEqual({ logicallyRemoved: true, state: "pending_delete", reused: true });
    expect(controlled.state().events).toBe(1);
  });

  it("does not invent removal semantics for legacy attachments", async () => {
    const controlled = controlledPool("legacy");
    await expect(logicallyRemoveTicketAttachment(input, controlled.pool)).rejects.toThrow("ATTACHMENT_NOT_REMOVABLE");
    expect(controlled.state()).toMatchObject({ attachmentState: "legacy", pendingDeleteAt: null, cleanupEligible: false, events: 0 });
  });

  it("keeps logical removal available for an active legacy row without granting cleanup provenance", async () => {
    const controlled = controlledPool("active", null);
    await expect(logicallyRemoveTicketAttachment(input, controlled.pool)).resolves.toEqual({ logicallyRemoved: true, state: "pending_delete", reused: false });
    expect(controlled.state()).toEqual({ attachmentState: "pending_delete", pendingDeleteAt: "set", cleanupEligible: false, events: 1, committed: true });
  });
});
