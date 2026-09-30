import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/main-migrations/0035_furry_stranger.sql", "utf8");
const schema = readFileSync("drizzle/schema.ts", "utf8");
const store = readFileSync("server/conversation-receipt-store.ts", "utf8");

describe("0035 pending conversation receipts", () => {
  it("STRUCTURAL is additive-only and creates the scoped idempotency identity", () => {
    expect(migration).toContain("CREATE TABLE `megadesk_conversation_pending_receipts`");
    expect(migration).toContain("CONSTRAINT `uq_mdpr_external_scope` UNIQUE(`client_id`,`provider`,`integration_id`,`external_message_id`)");
    expect(migration).toContain("CONSTRAINT `fk_mdpr_client` FOREIGN KEY (`client_id`)");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/i);
    expect(migration).not.toMatch(/\bALTER TABLE\b(?![^;]*ADD CONSTRAINT)/i);
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE FROM|INSERT INTO)\b/im);
  });

  it("STRUCTURAL provides indexed bounded retention without raw payload storage", () => {
    expect(migration).toContain("CREATE INDEX `idx_mdpr_expiry`");
    expect(migration).toContain("(`expires_at`,`replay_state`)");
    expect(migration).not.toMatch(/payload|body|authorization|token|media/i);
    expect(schema).toContain('export const megadeskConversationPendingReceipts = mysqlTable(');
    expect(store).toContain("PENDING_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1_000");
    expect(store).toContain("ORDER BY expires_at LIMIT ${boundedLimit}");
  });

  it("STRUCTURAL scopes persistence and replay by tenant, provider, integration and external identity", () => {
    const scopedPredicate = /client_id = \? AND provider = \? AND integration_id = \?[\s\S]*external_message_id = \?/g;
    expect(store.match(scopedPredicate)?.length).toBeGreaterThanOrEqual(1);
    expect(store).toContain("input.clientId");
    expect(store).toContain("input.provider");
    expect(store).toContain("input.integrationId");
    expect(store).toContain("input.externalMessageId");
    expect(store).not.toMatch(/phone|timestamp window|sender/i);
  });
});
