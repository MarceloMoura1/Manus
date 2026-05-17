/**
 * Testes de validação do schema SQL no db.ts
 *
 * MySQL não permite DEFAULT em colunas LONGTEXT, TEXT ou BLOB.
 * Este teste garante que nenhuma coluna desse tipo tenha DEFAULT.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const dbContent = readFileSync(join(__dirname, "db.ts"), "utf-8");

describe("Schema SQL — restrições MySQL", () => {
  it("não deve ter colunas LONGTEXT com DEFAULT value", () => {
    const matches = dbContent.match(/LONGTEXT[^,\n]*DEFAULT[^,\n]*/g);
    expect(matches).toBeNull();
  });

  it("não deve ter colunas TEXT com DEFAULT value", () => {
    // Exclui TIMESTAMP (que pode ter DEFAULT CURRENT_TIMESTAMP)
    const lines = dbContent.split("\n");
    const violations = lines.filter(
      (line) =>
        /\bTEXT\b/.test(line) &&
        /DEFAULT/.test(line) &&
        !/TIMESTAMP/.test(line) &&
        !/--/.test(line) // ignora comentários
    );
    expect(violations).toHaveLength(0);
  });

  it("não deve ter colunas BLOB com DEFAULT value", () => {
    const matches = dbContent.match(/BLOB[^,\n]*DEFAULT[^,\n]*/g);
    expect(matches).toBeNull();
  });

  it("integrations_json deve ser LONGTEXT NOT NULL sem DEFAULT", () => {
    expect(dbContent).toContain("integrations_json LONGTEXT NOT NULL,");
    expect(dbContent).not.toContain("integrations_json LONGTEXT NOT NULL DEFAULT");
  });

  it("INSERT de clientes deve sempre fornecer valor para integrations_json", () => {
    // Verifica que o INSERT inclui integrations_json na lista de colunas
    expect(dbContent).toContain("integrations_json) VALUES");
    // E que usa JSON.stringify para garantir valor não nulo
    expect(dbContent).toContain("JSON.stringify(client.integrations ?? {})");
  });

  it("modules_json deve ser LONGTEXT NOT NULL sem DEFAULT", () => {
    expect(dbContent).toContain("modules_json LONGTEXT NOT NULL,");
    expect(dbContent).not.toContain("modules_json LONGTEXT NOT NULL DEFAULT");
  });
});
