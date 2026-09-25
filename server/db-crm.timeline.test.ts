import { describe, expect, it, vi } from "vitest";
import { listCrmLifecycleTimeline, listCrmTimeline } from "./db-crm";

describe("CRM timeline persistence", () => {
  it("keeps manual entries scoped to the requested tenant and CRM client", async () => {
    const execute = vi.fn().mockResolvedValue([[{
      timeline_id: "note-a",
      entry_type: "note",
      description: "Nota do cliente A",
      author: "admin-a",
      created_at: "2026-09-25T10:00:00.000Z",
    }], []]);

    await expect(listCrmTimeline("crm-a", "tenant-a", { execute })).resolves.toEqual([{
      id: "note-a",
      type: "note",
      description: "Nota do cliente A",
      author: "admin-a",
      createdAt: "2026-09-25T10:00:00.000Z",
    }]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE crm_client_id = ? AND client_id = ?"), ["crm-a", "tenant-a"]);
  });

  it("exposes only lifecycle audit events that prove the requested CRM client within its tenant", async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        audit_id: "audit-a",
        action: "crm_client_deactivate",
        operator_user_id: "operator-a",
        metadata_json: JSON.stringify({ crmClientId: "crm-a", from: "active", to: "inactive" }),
        created_at: "2026-09-25T11:00:00.000Z",
      },
      {
        audit_id: "audit-other-client",
        action: "crm_client_archive",
        operator_user_id: "operator-a",
        metadata_json: JSON.stringify({ crmClientId: "crm-b", from: "active", to: "archived" }),
        created_at: "2026-09-25T12:00:00.000Z",
      },
      {
        audit_id: "audit-malformed",
        action: "crm_client_restore",
        operator_user_id: "operator-a",
        metadata_json: "not-json",
        created_at: "2026-09-25T13:00:00.000Z",
      },
    ], []]);

    await expect(listCrmLifecycleTimeline("crm-a", "tenant-a", { execute })).resolves.toEqual([{
      id: "audit-audit-a",
      type: "lifecycle_deactivate",
      description: "Estado operacional alterado de ativo para inativo.",
      author: "operator-a",
      createdAt: "2026-09-25T11:00:00.000Z",
    }]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE client_id = ?"), ["tenant-a"]);
  });
});
