import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync(new URL("./routers-conversations.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("./evolution/webhook.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/main-migrations/0013_fancy_mordo.sql", import.meta.url), "utf8");

describe("canonical attendance architecture", () => {
  it("keeps the new tenant router on megadesk_domain_conversations and away from wa_*", () => {
    expect(router).toContain("megadesk_domain_conversations");
    expect(router).not.toMatch(/wa_conversations|wa_messages/);
  });

  it("physically scopes every conversation update by tenant", () => {
    const updates = router.match(/UPDATE megadesk_domain_conversations[\s\S]*?WHERE[\s\S]*?(?=`|$)/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((statement) => statement.includes("client_id = ?"))).toBe(true);
  });

  it("creates a new inbound cycle by excluding closed attendances", () => {
    expect(webhook).toContain("status IN ('open', 'bot')");
    expect(webhook).toContain("'created_inbound'");
  });

  it("keeps migration additive, legacy-compatible and wa_* untouched", () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/ALTER TABLE `wa_|CREATE TABLE `wa_/i);
    expect(migration).toContain("ALTER TABLE `megadesk_domain_conversations_messages` ADD `client_id`");
    expect(migration).toContain("UNIQUE(`client_id`,`provider`,`integration_id`,`external_message_id`)");
    expect(migration).toContain("UNIQUE(`client_id`,`client_attempt_id`)");
    expect(migration).toContain("ADD `media_reference` longtext");
    expect(migration).not.toContain("messages_json");
  });

  it("uses one cross-process lock identity for inbound and outbound", () => {
    const legacyRouter = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    expect(webhook).toContain('.digest("hex").slice(0, 54)');
    expect(legacyRouter).toContain('.digest("hex").slice(0, 54)');
    expect(webhook).toContain("`mdc-phone:${phoneLockKey}`");
    expect(legacyRouter).toContain("`mdc-phone:${phoneLockKey}`");
  });

  it("orders equal timestamps by immutable message id", () => {
    expect(router).toContain("ORDER BY m.timestamp ASC, m.message_id ASC");
  });
});
