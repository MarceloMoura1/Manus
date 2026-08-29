import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(join(process.cwd(), "windows/Diagnosticar-MegaDesk.ps1"), "utf8");
const installer = readFileSync(join(process.cwd(), "windows/Instalar-Atalhos-MegaDesk.ps1"), "utf8");

describe("Windows read-only diagnostics", () => {
  it("declares PowerShell 5.1 and a bounded sanitized report", () => {
    expect(script).toContain("#requires -Version 5.1"); expect(script).toContain("$maxReportBytes = 65536");
    expect(script).toContain("ConvertTo-Json"); expect(script).toContain("diagnostics");
  });
  it("contains no mutating operational commands", () => {
    for (const forbidden of ["docker compose up", "docker compose down", "docker restart", "docker rm", "git ", "Repair", "Connect", "logout", "QRCODE_UPDATED", ".env.local", "Stop-Process", "Start-Process"]) expect(script).not.toContain(forbidden);
  });
  it("only inspects exact Evolution container names", () => {
    expect(script).toContain("@('megadesk-evolution', 'megadesk-evolution-db')");
    expect(script).toContain("docker inspect"); expect(script).toContain("docker logs --tail 300");
  });
  it("preserves existing shortcuts and adds diagnostics without starting services", () => {
    for (const name of ["Iniciar MegaDesk.lnk", "Atualizar MegaDesk.lnk", "Parar MegaDesk.lnk", "Diagnosticar MegaDesk.lnk"]) expect(installer).toContain(name);
    expect(installer).not.toContain("Start-Process");
  });
});
