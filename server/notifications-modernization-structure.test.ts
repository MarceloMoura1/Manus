import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("modern internal notifications contract", () => {
  it("renders the authoritative notifications page from Home", () => {
    const home = read("client/src/pages/Home.tsx");
    const app = read("client/src/App.tsx");
    expect(home).toContain('import { NotificationsModernPage } from "./NotificationsModernPage"');
    expect(home).toContain("<NotificationsModernPage />");
    expect(app).toContain('import { NotificationsModernPage } from "./pages/NotificationsModernPage"');
    expect(app).toContain("isNotificationsRoute() ? <NotificationsModernPage />");
    expect(app).not.toContain('from "./pages/NotificationsPage"');
  });

  it("does not send tenant identity or expose test and delete actions", () => {
    const page = read("client/src/pages/NotificationsModernPage.tsx");
    expect(page).not.toMatch(/clientId|localStorage|test-client|createNotification|deleteNotification/);
    expect(page).toContain("listV2");
    expect(page).toContain("markAsReadV2");
    expect(page).toContain("markAllAsReadV2");
  });

  it("derives identity server-side and permits only internal deep links", () => {
    const router = read("server/routers-notifications.ts");
    expect(router).toContain("authoritativeIdentity(ctx)");
    expect(router).toContain("ctx.tenantId");
    expect(router).toContain("ctx.operationalUserId");
    expect(router).toContain('value.startsWith("//")');
    expect(router).toContain('code: "FORBIDDEN"');
    expect(router).not.toContain("legacy implementation intentionally unreachable");
    expect(router).not.toMatch(/INSERT\s+INTO\s+wa_|UPDATE\s+wa_|DELETE\s+FROM\s+wa_/i);
  });
});
