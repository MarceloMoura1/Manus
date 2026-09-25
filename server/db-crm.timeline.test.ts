import { describe, expect, it, vi } from "vitest";
import { listCrmLifecycleTimeline, listCrmTimeline } from "./db-crm";

describe("CRM timeline persistence", () => {
  it("keeps manual entries scoped to the requested tenant and CRM client", async () => {
    const execute = vi.fn().mockResolvedValue([[{
      timeline_id: "note-a",
      entry_type: "note",
      description: "Nota do cliente A",
      author: "Ana Administradora",
      created_at: "2026-09-25T10:00:00.000Z",
    }], []]);

    await expect(listCrmTimeline("crm-a", "tenant-a", { execute })).resolves.toEqual([{
      id: "note-a",
      type: "note",
      description: "Nota do cliente A",
      author: "Ana Administradora",
      createdAt: "2026-09-25T10:00:00.000Z",
    }]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE t.crm_client_id = ? AND t.client_id = ?"), ["crm-a", "tenant-a"]);
    expect(execute.mock.calls[0][0]).toContain("u.client_id = t.client_id AND LOWER(u.email) = LOWER(t.author)");
  });

  it("exposes only lifecycle audit events that prove the requested CRM client within its tenant", async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        audit_id: "audit-a",
        action: "crm_client_deactivate",
        operator_user_id: "operator-a",
        author: "Ana Administradora",
        metadata_json: JSON.stringify({ crmClientId: "crm-a", from: "active", to: "inactive" }),
        created_at: "2026-09-25T11:00:00.000Z",
      },
      {
        audit_id: "audit-other-client",
        action: "crm_client_archive",
        operator_user_id: "operator-a",
        author: "Ana Administradora",
        metadata_json: JSON.stringify({ crmClientId: "crm-b", from: "active", to: "archived" }),
        created_at: "2026-09-25T12:00:00.000Z",
      },
      {
        audit_id: "audit-malformed",
        action: "crm_client_restore",
        operator_user_id: "operator-a",
        author: "Ana Administradora",
        metadata_json: "not-json",
        created_at: "2026-09-25T13:00:00.000Z",
      },
    ], []]);

    await expect(listCrmLifecycleTimeline("crm-a", "tenant-a", { execute })).resolves.toEqual([{
      id: "audit-audit-a",
      type: "lifecycle_deactivate",
      description: "Estado operacional alterado de ativo para inativo.",
      author: "Ana Administradora",
      createdAt: "2026-09-25T11:00:00.000Z",
    }]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE a.client_id = ?"), ["tenant-a"]);
    expect(execute.mock.calls[0][0]).toContain("u.client_id = a.client_id AND u.user_id = a.operator_user_id");
  });

  it("keeps the persisted actor as a safe fallback when no tenant user name resolves", async () => {
    const execute = vi.fn().mockResolvedValue([[
      { timeline_id: "system", entry_type: "edit", description: "Evento", author: "Sistema", created_at: "2026-09-25T10:00:00.000Z" },
      { timeline_id: "legacy", entry_type: "edit", description: "Evento legado", author: "legacy@example.invalid", created_at: "2026-09-25T09:00:00.000Z" },
    ], []]);

    const entries = await listCrmTimeline("crm-a", "tenant-a", { execute });
    expect(entries.map(entry => entry.author)).toEqual(["Sistema", "legacy@example.invalid"]);
  });

  it("projects the tenant-resolved name into historical automatic descriptions without changing manual notes", async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        timeline_id: "edit-a",
        entry_type: "edit",
        description: "Cadastro editado por admin@example.invalid",
        persisted_author: "admin@example.invalid",
        author: "Marcelo Moura",
        created_at: "2026-09-25T10:00:00.000Z",
      },
      {
        timeline_id: "note-a",
        entry_type: "note",
        description: "Falei por admin@example.invalid",
        persisted_author: "admin@example.invalid",
        author: "Marcelo Moura",
        created_at: "2026-09-25T09:00:00.000Z",
      },
    ], []]);

    const entries = await listCrmTimeline("crm-a", "tenant-a", { execute });
    expect(entries[0]).toMatchObject({ description: "Cadastro editado por Marcelo Moura", author: "Marcelo Moura" });
    expect(entries[1]).toMatchObject({ description: "Falei por admin@example.invalid", author: "Marcelo Moura" });
  });
});
