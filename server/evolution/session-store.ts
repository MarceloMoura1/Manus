/**
 * Evolution Session Store
 * Persiste o estado de cada sessão WhatsApp (por clientId) no banco de dados.
 * Usa a tabela `megadesk_evolution_sessions` criada pela migration abaixo.
 *
 * SQL (rodar uma vez no banco):
 * ─────────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS `megadesk_evolution_sessions` (
 *   `client_id`       VARCHAR(80)  NOT NULL,
 *   `instance_name`   VARCHAR(120) NOT NULL,
 *   `status`          ENUM('disconnected','connecting','connected') NOT NULL DEFAULT 'disconnected',
 *   `phone_number`    VARCHAR(30)  DEFAULT NULL,
 *   `connected_at`    TIMESTAMP    DEFAULT NULL,
 *   `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   PRIMARY KEY (`client_id`),
 *   UNIQUE KEY `uq_evo_instance` (`instance_name`)
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ─────────────────────────────────────────────────────────
 */

import { getPool } from "../db";

export interface EvolutionSession {
  clientId: string;
  instanceName: string;
  status: "disconnected" | "connecting" | "connected";
  phoneNumber: string | null;
  connectedAt: Date | null;
}

/** Retorna o nome canônico da instância para um clientId. */
export function instanceNameFor(clientId: string): string {
  // Ex: "cliente-001" → "megadesk-cliente-001"
  return `megadesk-${clientId}`;
}

/** Garante que a tabela existe (idempotente). */
export async function ensureSessionTable(): Promise<void> {
  const pool = getPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`megadesk_evolution_sessions\` (
      \`client_id\`     VARCHAR(80)  NOT NULL,
      \`instance_name\` VARCHAR(120) NOT NULL,
      \`status\`        ENUM('disconnected','connecting','connected') NOT NULL DEFAULT 'disconnected',
      \`phone_number\`  VARCHAR(30)  DEFAULT NULL,
      \`connected_at\`  TIMESTAMP    DEFAULT NULL,
      \`created_at\`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`client_id\`),
      UNIQUE KEY \`uq_evo_instance\` (\`instance_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

/** Busca a sessão de um cliente. Retorna null se não existir. */
export async function getSession(clientId: string): Promise<EvolutionSession | null> {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT client_id, instance_name, status, phone_number, connected_at
     FROM megadesk_evolution_sessions
     WHERE client_id = ?
     LIMIT 1`,
    [clientId]
  ) as any[];

  if (!rows || rows.length === 0) return null;

  const r = rows[0];
  return {
    clientId:     r.client_id,
    instanceName: r.instance_name,
    status:       r.status,
    phoneNumber:  r.phone_number ?? null,
    connectedAt:  r.connected_at ? new Date(r.connected_at) : null,
  };
}

/** Cria ou atualiza a sessão de um cliente. */
export async function upsertSession(
  clientId: string,
  instanceName: string,
  status: EvolutionSession["status"],
  phoneNumber?: string | null
): Promise<void> {
  const pool = getPool();
  const connectedAt = status === "connected" ? new Date() : null;

  await pool.execute(
    `INSERT INTO megadesk_evolution_sessions
       (client_id, instance_name, status, phone_number, connected_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       instance_name = VALUES(instance_name),
       status        = VALUES(status),
       phone_number  = COALESCE(VALUES(phone_number), phone_number),
       connected_at  = COALESCE(VALUES(connected_at), connected_at),
       updated_at    = CURRENT_TIMESTAMP`,
    [clientId, instanceName, status, phoneNumber ?? null, connectedAt]
  );
}

/** Remove a sessão do banco (usado ao desconectar). */
export async function deleteSession(clientId: string): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `DELETE FROM megadesk_evolution_sessions WHERE client_id = ?`,
    [clientId]
  );
}
