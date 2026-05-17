/**
 * Testes para validar que não há múltiplos SQL statements em uma única execute()
 *
 * O driver MySQL2 não permite múltiplos statements separados por ";"
 * em uma única chamada execute(). Este teste verifica que o db.ts
 * não contém esse padrão problemático.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const dbContent = readFileSync(join(__dirname, "db.ts"), "utf-8");

/**
 * Detecta se uma string SQL contém múltiplos statements (separados por ";")
 * Ignora comentários e strings literais simples.
 */
function hasMultipleStatements(sql: string): boolean {
  // Remove comentários de linha (-- ...)
  const noLineComments = sql.replace(/--[^\n]*/g, "");
  // Conta ponto-e-vírgulas fora de strings
  let inString = false;
  let stringChar = "";
  let semicolonCount = 0;
  for (let i = 0; i < noLineComments.length; i++) {
    const ch = noLineComments[i];
    if (!inString && (ch === "'" || ch === '"' || ch === "`")) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar && noLineComments[i - 1] !== "\\") {
      inString = false;
    } else if (!inString && ch === ";") {
      semicolonCount++;
    }
  }
  return semicolonCount > 1;
}

/**
 * Extrai todos os blocos de template literals passados para execute()
 */
function extractExecuteBlocks(content: string): string[] {
  const blocks: string[] = [];
  // Captura execute(`...`) com template literals
  const regex = /\.execute\(`([\s\S]*?)`\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe("SQL statements no db.ts", () => {
  it("não deve ter múltiplos statements em uma única execute() com template literal", () => {
    const blocks = extractExecuteBlocks(dbContent);
    const violations: string[] = [];

    for (const block of blocks) {
      if (hasMultipleStatements(block)) {
        // Pegar as primeiras 100 chars para identificar o bloco
        violations.push(block.substring(0, 100).trim());
      }
    }

    if (violations.length > 0) {
      console.error("Blocos com múltiplos statements encontrados:");
      violations.forEach((v, i) => console.error(`  ${i + 1}. ${v}...`));
    }

    expect(violations).toHaveLength(0);
  });

  it("deve ter cada migração ALTER TABLE em sua própria execute()", () => {
    // Verifica que as migrações estão no array `migrations` e não em blocos execute()
    expect(dbContent).toContain("const migrations = [");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS email");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS cnpj");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS max_users");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS status_type");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS integrations_json");
  });

  it("deve ter migração de password_hash separada do CREATE TABLE", () => {
    // password_hash deve estar no CREATE TABLE E como migração separada
    expect(dbContent).toContain("password_hash VARCHAR(255)");
    expect(dbContent).toContain("ALTER TABLE megadesk_domain_client_users ADD COLUMN IF NOT EXISTS password_hash");
  });

  it("função hasMultipleStatements deve detectar corretamente", () => {
    // Deve detectar múltiplos statements
    expect(hasMultipleStatements("SELECT 1; SELECT 2;")).toBe(true);
    expect(hasMultipleStatements("CREATE TABLE t (id INT); ALTER TABLE t ADD col VARCHAR(10);")).toBe(true);

    // Não deve detectar falso positivo em string com ponto-e-vírgula
    expect(hasMultipleStatements("SELECT 'hello; world'")).toBe(false);

    // Um único statement não é múltiplo
    expect(hasMultipleStatements("CREATE TABLE t (id INT PRIMARY KEY)")).toBe(false);
    expect(hasMultipleStatements("DELETE FROM t WHERE id = ?")).toBe(false);
  });

  it("deleteClientFromDb deve usar execute() separados para cada DELETE", () => {
    // Verifica que a função usa dois execute() separados
    const deleteFunc = dbContent.substring(
      dbContent.indexOf("export async function deleteClientFromDb"),
      dbContent.indexOf("export async function deleteClientFromDb") + 1000
    );
    expect(deleteFunc).toContain("DELETE FROM megadesk_domain_client_users WHERE client_id = ?");
    expect(deleteFunc).toContain("DELETE FROM megadesk_domain_clients WHERE client_id = ?");
    // Não deve ter os dois DELETEs em uma única execute()
    const combinedDelete = "DELETE FROM megadesk_domain_client_users WHERE client_id = ?; DELETE FROM megadesk_domain_clients";
    expect(deleteFunc).not.toContain(combinedDelete);
  });
});
