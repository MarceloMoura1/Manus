/**
 * Bot Module — Typebot Workspace Multi-Tenant Provisioning Service
 *
 * Gerencia o provisionamento automático de Workspaces isolados por tenant (clientId)
 * no banco PostgreSQL do Typebot, garantindo que cada cliente tenha seu próprio ambiente,
 * bots isolados, e auto-login sem exigir autenticação manual no iframe.
 */
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";
import { getTypebotBuilderPublicUrl } from "./typebot-proxy";

export interface ClientWorkspaceResult {
  workspaceId: string;
  workspaceName: string;
  sessionToken: string;
  loginUrl: string;
  directUrl: string;
  isNewWorkspace: boolean;
}

/** Gera um ID compatível com o padrão CUID (25 caracteres alfanuméricos) */
export function generateCuid(prefix = "c"): string {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(8).toString("hex").substring(0, 15);
  return `${prefix}${ts}${rnd}`.substring(0, 25);
}

/** Cria a estrutura JSON do template padrão de Typebot com nó de boas-vindas e transferência */
export function createDefaultTypebotTemplate() {
  const startEventId = generateCuid("e");
  const welcomeGroupId = generateCuid("g");
  const welcomeBlockId = generateCuid("b");
  const transferGroupId = generateCuid("g");
  const transferBlockId = generateCuid("b");

  const edgeStartToWelcome = generateCuid("d");
  const edgeWelcomeToTransfer = generateCuid("d");

  const groups = [
    {
      id: welcomeGroupId,
      title: "Boas-vindas",
      graphCoordinates: { x: 260, y: 0 },
      blocks: [
        {
          id: welcomeBlockId,
          type: "text",
          content: {
            richText: [
              {
                id: generateCuid("p"),
                type: "p",
                children: [
                  { text: "Olá! Seja bem-vindo ao nosso atendimento via MegaDesk." },
                ],
              },
            ],
          },
          outgoingEdgeId: edgeWelcomeToTransfer,
        },
      ],
    },
    {
      id: transferGroupId,
      title: "Transferência Humana",
      graphCoordinates: { x: 620, y: 0 },
      blocks: [
        {
          id: transferBlockId,
          type: "text",
          content: {
            richText: [
              {
                id: generateCuid("p"),
                type: "p",
                children: [
                  { text: "Vou transferir você para um de nossos atendentes. Aguarde um instante por favor!" },
                ],
              },
            ],
          },
        },
      ],
    },
  ];

  const events = [
    {
      id: startEventId,
      type: "start",
      outgoingEdgeId: edgeStartToWelcome,
      graphCoordinates: { x: 0, y: 0 },
    },
  ];

  const edges = [
    {
      id: edgeStartToWelcome,
      from: { eventId: startEventId },
      to: { groupId: welcomeGroupId },
    },
    {
      id: edgeWelcomeToTransfer,
      from: { blockId: welcomeBlockId },
      to: { groupId: transferGroupId },
    },
  ];

  return {
    version: "6.1",
    groups,
    events,
    edges,
    theme: {},
    settings: {},
    variables: [],
  };
}

class TypebotWorkspaceService {
  private pool: Pool | null = null;

  /** Retorna ou inicializa o pool PostgreSQL do Typebot */
  public getPool(): Pool {
    if (this.pool) return this.pool;

    const connectionString =
      process.env.TYPEBOT_DATABASE_URL ||
      "postgresql://typebot:typebot@typebot-db:5432/typebot?schema=public";

    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on("error", (err) => {
      console.error("[TypebotWorkspaceService] Erro inesperado no pool Postgres do Typebot:", err.message);
    });

    return this.pool;
  }

  /** Permite injetar pool para testes unitários */
  public setPool(pool: Pool | null) {
    this.pool = pool;
  }

  /**
   * Obtém ou provisiona o workspace exclusivo do cliente MegaDesk no Typebot,
   * criando o usuário, workspace, associação de admin, template inicial e sessão de auto-login.
   */
  public async getOrCreateClientWorkspace(
    clientId: string,
    clientName: string,
    userEmail: string,
    userName?: string
  ): Promise<ClientWorkspaceResult> {
    if (!clientId || !clientId.trim()) {
      throw new Error("clientId é obrigatório para provisionamento de workspace no Typebot.");
    }

    const cleanClientId = clientId.trim();
    const cleanClientName = (clientName || "Cliente").trim();
    const workspaceExpectedName = `MegaDesk - ${cleanClientName}`;
    const cleanEmail = (userEmail || `admin@${cleanClientId}.megadesk.online`).trim().toLowerCase();
    const cleanUserName = (userName || "Administrador").trim();

    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // ─── 1. Buscar ou criar o Usuário no Typebot ─────────────────────────
      let userId: string;
      const userRes = await client.query(
        `SELECT id, name FROM "User" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [cleanEmail]
      );

      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
        // Atualiza o nome caso esteja vazio
        if (!userRes.rows[0].name && cleanUserName) {
          await client.query(
            `UPDATE "User" SET name = $1, "updatedAt" = NOW() WHERE id = $2`,
            [cleanUserName, userId]
          );
        }
      } else {
        userId = generateCuid("u");
        await client.query(
          `INSERT INTO "User" (
            id, name, email, "emailVerified", "createdAt", "updatedAt", "lastActivityAt", "onboardingCategories"
          ) VALUES ($1, $2, $3, NOW(), NOW(), NOW(), NOW(), '[]'::jsonb)`,
          [userId, cleanUserName, cleanEmail]
        );
      }

      // ─── 2. Buscar ou criar o Workspace exclusivo do Cliente ─────────────
      let workspaceId: string;
      let isNewWorkspace = false;

      // Busca por metadados de clientId salvos nas settings ou pelo nome exclusivo
      const wsRes = await client.query(
        `SELECT id, name FROM "Workspace" 
         WHERE settings->>'megadeskClientId' = $1 
            OR name = $2 
         LIMIT 1`,
        [cleanClientId, workspaceExpectedName]
      );

      if (wsRes.rows.length > 0) {
        workspaceId = wsRes.rows[0].id;
        // Garante que o metadado megadeskClientId esteja persistido nas settings
        await client.query(
          `UPDATE "Workspace" 
           SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
               "updatedAt" = NOW()
           WHERE id = $2`,
          [JSON.stringify({ megadeskClientId: cleanClientId, clientName: cleanClientName }), workspaceId]
        );
      } else {
        isNewWorkspace = true;
        workspaceId = generateCuid("w");
        const settingsJson = JSON.stringify({
          megadeskClientId: cleanClientId,
          clientName: cleanClientName,
          provisionedBy: "megadesk-platform",
          provisionedAt: new Date().toISOString(),
        });

        await client.query(
          `INSERT INTO "Workspace" (
            id, name, plan, settings, "createdAt", "updatedAt"
          ) VALUES ($1, $2, 'UNLIMITED', $3::jsonb, NOW(), NOW())`,
          [workspaceId, workspaceExpectedName, settingsJson]
        );
      }

      // ─── 3. Vincular o usuário ao Workspace como ADMIN ───────────────────
      const memberRes = await client.query(
        `SELECT role FROM "MemberInWorkspace" WHERE "userId" = $1 AND "workspaceId" = $2 LIMIT 1`,
        [userId, workspaceId]
      );

      if (memberRes.rows.length === 0) {
        await client.query(
          `INSERT INTO "MemberInWorkspace" (
            "userId", "workspaceId", role, "createdAt", "updatedAt"
          ) VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
          [userId, workspaceId]
        );
      }

      // ─── 4. Template Inicial: criar Typebot padrão se for workspace novo ──
      if (isNewWorkspace) {
        const typebotRes = await client.query(
          `SELECT id FROM "Typebot" WHERE "workspaceId" = $1 LIMIT 1`,
          [workspaceId]
        );

        if (typebotRes.rows.length === 0) {
          const typebotId = generateCuid("t");
          const template = createDefaultTypebotTemplate();

          await client.query(
            `INSERT INTO "Typebot" (
              id, name, version, groups, events, edges, theme, settings, variables,
              "workspaceId", "isArchived", "isClosed", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
              $10, false, false, NOW(), NOW()
            )`,
            [
              typebotId,
              "Atendimento Padrão",
              template.version,
              JSON.stringify(template.groups),
              JSON.stringify(template.events),
              JSON.stringify(template.edges),
              JSON.stringify(template.theme),
              JSON.stringify(template.settings),
              JSON.stringify(template.variables),
              workspaceId,
            ]
          );
        }
      }

      // ─── 5. Gerar Sessão de Auto-Login no Typebot ─────────────────────────
      // Remove sessões expiradas para manter a tabela limpa
      await client.query(`DELETE FROM "Session" WHERE expires < NOW()`).catch(() => {});

      const sessionToken = crypto.randomUUID();
      const sessionId = generateCuid("s");
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

      await client.query(
        `INSERT INTO "Session" (id, "sessionToken", "userId", expires) VALUES ($1, $2, $3, $4)`,
        [sessionId, sessionToken, userId, expires]
      );

      await client.query("COMMIT");

      const basePublicUrl = getTypebotBuilderPublicUrl();
      const directUrl = `${basePublicUrl}/w/${workspaceId}/typebots`;
      const loginUrl = `${basePublicUrl}/api/megadesk-login?token=${sessionToken}&workspaceId=${workspaceId}`;

      return {
        workspaceId,
        workspaceName: workspaceExpectedName,
        sessionToken,
        loginUrl,
        directUrl,
        isNewWorkspace,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[TypebotWorkspaceService] Erro ao provisionar workspace:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

export const typebotWorkspaceService = new TypebotWorkspaceService();

