import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Request, Response } from "express";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import sharp from "sharp";
import { userPersonalizationRouter } from "./routers-user-personalization";
import {
  applyCanonicalMainPrefixForTest,
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "./_core/canonical-migrations";
import { getPool } from "./db";
import { registerUserPersonalizationRoutes } from "./user-personalization";
import {
  createOperationalSession,
  MEGADESK_SESSION_COOKIE,
  MysqlOperationalSessionRepository,
} from "./_core/megadesk-session";

const physical = describe.runIf(process.env.RUN_DATABASE_INTEGRATION === "1");
const DATABASES = [
  "megadesk_test_personalization",
  "megadesk_test_personalization_fresh",
  "megadesk_test_personalization_upgrade",
] as const;
const BASE_DATABASE = DATABASES[0];
const FRESH_DATABASE = DATABASES[1];
const UPGRADE_DATABASE = DATABASES[2];
const TENANT_A = "personalization-tenant-a";
const TENANT_B = "personalization-tenant-b";

let adminPool: Pool;
let priorFolder = "";

function databaseUrl(database: string): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      "TEST_DATABASE_URL is required for personalization integration."
    );
  const url = new URL(raw);
  if (
    url.protocol !== "mysql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "33321"
  ) {
    throw new Error(
      "Personalization integration requires the dedicated disposable MySQL instance on 127.0.0.1:33321."
    );
  }
  if (!DATABASES.includes(database as (typeof DATABASES)[number]))
    throw new Error("Unexpected personalization test database.");
  url.pathname = `/${database}`;
  return url.toString();
}

function adminDatabaseUrl(): string {
  const url = new URL(databaseUrl(BASE_DATABASE));
  url.pathname = "/mysql";
  return url.toString();
}

function mainPrefixMigrationFolder(lastTag: string, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  cpSync(MAIN_MIGRATIONS_DIR, folder, { recursive: true });
  const journalPath = resolve(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const lastIndex = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (lastIndex < 0) throw new Error(`Canonical migration prefix tag not found: ${lastTag}`);
  const removedTags = journal.entries.slice(lastIndex + 1).map((entry) => entry.tag);
  journal.entries = journal.entries.slice(0, lastIndex + 1);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  for (const tag of removedTags) {
    rmSync(resolve(folder, `${tag}.sql`), { force: true });
    rmSync(resolve(folder, `meta/${tag.slice(0, 4)}_snapshot.json`), {
      force: true,
    });
  }
  return folder;
}

async function recreateDatabase(database: string): Promise<void> {
  await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await adminPool.query(`CREATE DATABASE \`${database}\``);
}

async function scalar(
  pool: Pool,
  sql: string,
  values: unknown[] = []
): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, values);
  return Number(rows[0]?.value ?? 0);
}

function caller(tenantId: string, userId: string, userEmail: string) {
  return userPersonalizationRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    user: null,
    tenantId,
    userEmail,
    operationalUserId: userId,
    operationalUserRole: "agent",
  });
}

async function insertIdentityFixtures(pool: Pool): Promise<void> {
  await pool.execute(
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN (?, ?)",
    [TENANT_A, TENANT_B]
  );
  await pool.execute(
    "DELETE FROM megadesk_user_settings WHERE client_id IN (?, ?)",
    [TENANT_A, TENANT_B]
  );
  await pool.execute(
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN (?, ?)",
    [TENANT_A, TENANT_B]
  );
  await pool.execute(
    "DELETE FROM megadesk_domain_clients WHERE client_id IN (?, ?)",
    [TENANT_A, TENANT_B]
  );
  await pool.execute(
    `INSERT INTO megadesk_domain_clients
      (client_id, internal_id, tenant_database_name, company, contact, phone, plan, status, status_type,
       access_released, api_token, modules_json, integrations_json)
     VALUES (?, ?, ?, 'Personalization A', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, ?, '[]', '{}'),
            (?, ?, ?, 'Personalization B', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, ?, '[]', '{}')`,
    [
      TENANT_A,
      "personalization-internal-a",
      "mdsk_personalization_a",
      "synthetic-a",
      TENANT_B,
      "personalization-internal-b",
      "mdsk_personalization_b",
      "synthetic-b",
    ]
  );
  await pool.execute(
    `INSERT INTO megadesk_domain_client_users
      (user_id, client_id, name, email, role, status, permissions_json)
     VALUES ('personalization-user-a', ?, 'User A', 'personalization-a@example.invalid', 'agent', 'active', '[]'),
            ('personalization-user-b', ?, 'User B', 'personalization-b@example.invalid', 'agent', 'active', '[]'),
            ('personalization-tenant-b-user', ?, 'Tenant B User', 'tenant-user@example.invalid', 'agent', 'active', '[]')`,
    [TENANT_A, TENANT_A, TENANT_B]
  );
}

function request(
  cookie?: string,
  headers: Record<string, string> = {}
): Request {
  return Object.assign(Object.create(null), {
    headers: { ...headers, cookie },
    secure: false,
    cookies: {},
  }) as Request;
}

function response(): Response {
  return Object.assign(Object.create(null), {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  }) as Response;
}

async function session(userId: string, tenantId: string): Promise<string> {
  const res = response();
  await createOperationalSession(
    { userId, clientId: tenantId },
    res,
    request(),
    new MysqlOperationalSessionRepository(),
    () => `${userId}-synthetic-session-token-000000000000000000000`.slice(0, 43)
  );
  return vi.mocked(res.cookie).mock.calls[0][1] as string;
}

physical("user personalization against disposable MySQL", () => {
  beforeAll(async () => {
    priorFolder = mainPrefixMigrationFolder(
      "0020_nice_microbe",
      "megadesk-personalization-prior-"
    );
    adminPool = mysql.createPool({ uri: adminDatabaseUrl(), timezone: "Z" });
    for (const database of DATABASES) {
      await recreateDatabase(database);
      if (database !== FRESH_DATABASE)
        await applyCanonicalMainPrefixForTest(databaseUrl(database), priorFolder);
    }
  }, 180_000);

  afterAll(async () => {
    try {
      for (const database of DATABASES)
        await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
      if (priorFolder) rmSync(priorFolder, { recursive: true, force: true });
      await adminPool.end();
      try {
        await getPool().end();
      } catch {
        /* pool may not have been created */
      }
    }
  }, 180_000);

  it("runs the complete fresh chain and registers 0021 exactly once", async () => {
    await applyCanonicalMigrations(
      databaseUrl(FRESH_DATABASE),
      MAIN_MIGRATIONS_DIR
    );
    expect(
      await scalar(
        adminPool,
        "SELECT COUNT(*) AS value FROM `megadesk_test_personalization_fresh`.`__drizzle_migrations`"
      )
    ).toBe(22);
    expect(
      await scalar(
        adminPool,
        "SELECT COUNT(*) AS value FROM `megadesk_test_personalization_fresh`.`__drizzle_migrations` WHERE hash IS NOT NULL AND created_at IS NOT NULL"
      )
    ).toBe(22);
    const [columns] = await adminPool.execute<RowDataPacket[]>(
      "SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default FROM information_schema.columns WHERE table_schema=? AND table_name='megadesk_user_settings' AND column_name IN ('conversation_background_type','conversation_background_preset_id','conversation_background_image_key','conversation_incoming_bubble_color','conversation_outgoing_bubble_color') ORDER BY ordinal_position",
      [FRESH_DATABASE]
    );
    expect(columns).toEqual([
      expect.objectContaining({
        column_name: "conversation_background_type",
        column_type: "varchar(16)",
        is_nullable: "NO",
        column_default: "default",
      }),
      expect.objectContaining({
        column_name: "conversation_background_preset_id",
        column_type: "varchar(64)",
        is_nullable: "YES",
        column_default: null,
      }),
      expect.objectContaining({
        column_name: "conversation_background_image_key",
        column_type: "varchar(128)",
        is_nullable: "YES",
        column_default: null,
      }),
      expect.objectContaining({
        column_name: "conversation_incoming_bubble_color",
        column_type: "varchar(7)",
        is_nullable: "YES",
        column_default: null,
      }),
      expect.objectContaining({
        column_name: "conversation_outgoing_bubble_color",
        column_type: "varchar(7)",
        is_nullable: "YES",
        column_default: null,
      }),
    ]);
  }, 180_000);

  it("preserves preexisting rows across the official 0020 to 0021 upgrade and is idempotent", async () => {
    const upgradePool = mysql.createPool({
      uri: databaseUrl(UPGRADE_DATABASE),
      timezone: "Z",
    });
    try {
      expect(
        await scalar(
          upgradePool,
          "SELECT COUNT(*) AS value FROM __drizzle_migrations"
        )
      ).toBe(21);
      await upgradePool.execute(
        "INSERT INTO megadesk_user_settings (id, client_id, user_id, notifications_enabled, sound_volume) VALUES ('upgrade-settings-a', 'upgrade-tenant', 'upgrade-user-a', 0, 41), ('upgrade-settings-b', 'upgrade-tenant', 'upgrade-user-b', 1, 82)"
      );
      const [before] = await upgradePool.execute<RowDataPacket[]>(
        "SELECT id, client_id, user_id, notifications_enabled, sound_volume FROM megadesk_user_settings ORDER BY id"
      );
      expect(before).toHaveLength(2);
      await applyCanonicalMigrations(
        databaseUrl(UPGRADE_DATABASE),
        MAIN_MIGRATIONS_DIR
      );
      const [after] = await upgradePool.execute<RowDataPacket[]>(
        "SELECT id, client_id, user_id, notifications_enabled, sound_volume FROM megadesk_user_settings ORDER BY id"
      );
      expect(after).toEqual(before);
      const [defaultBubbleColors] = await upgradePool.execute<RowDataPacket[]>(
        "SELECT conversation_incoming_bubble_color AS incomingBubbleColor, conversation_outgoing_bubble_color AS outgoingBubbleColor FROM megadesk_user_settings ORDER BY id"
      );
      expect(defaultBubbleColors).toEqual([
        { incomingBubbleColor: null, outgoingBubbleColor: null },
        { incomingBubbleColor: null, outgoingBubbleColor: null },
      ]);
      expect(
        await scalar(
          upgradePool,
          "SELECT COUNT(*) AS value FROM __drizzle_migrations"
        )
      ).toBe(22);
      await applyCanonicalMigrations(
        databaseUrl(UPGRADE_DATABASE),
        MAIN_MIGRATIONS_DIR
      );
      expect(
        await scalar(
          upgradePool,
          "SELECT COUNT(*) AS value FROM __drizzle_migrations"
        )
      ).toBe(22);
      expect(
        await scalar(
          upgradePool,
          "SELECT COUNT(*) AS value FROM __drizzle_migrations WHERE hash IS NOT NULL AND created_at IS NOT NULL"
        )
      ).toBe(22);
    } finally {
      await upgradePool.end();
    }
  }, 180_000);

  it("persists independent preferences through fresh callers and protects the upload endpoint", async () => {
    await applyCanonicalMigrations(
      databaseUrl(BASE_DATABASE),
      MAIN_MIGRATIONS_DIR
    );
    const pool = getPool();
    await insertIdentityFixtures(pool);

    const userA = caller(
      TENANT_A,
      "personalization-user-a",
      "personalization-a@example.invalid"
    );
    const userB = caller(
      TENANT_A,
      "personalization-user-b",
      "personalization-b@example.invalid"
    );
    expect(
      await userA.get({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "default",
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    });
    await expect(
      userA.save({
        clientId: TENANT_B,
        userEmail: "personalization-b@example.invalid",
        backgroundType: "default",
        presetId: null,
        incomingBubbleColor: "#FAE8FF",
        outgoingBubbleColor: "#6D28D9",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      userA.save({
        clientId: TENANT_A,
        userEmail: "personalization-b@example.invalid",
        backgroundType: "default",
        presetId: null,
        incomingBubbleColor: "#FAE8FF",
        outgoingBubbleColor: "#6D28D9",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await userA.save({
      clientId: TENANT_A,
      userEmail: "personalization-a@example.invalid",
      backgroundType: "default",
      presetId: null,
      incomingBubbleColor: "#FAE8FF",
      outgoingBubbleColor: "#6D28D9",
    });
    expect(
      await userA.get({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "default",
      incomingBubbleColor: "#FAE8FF",
      outgoingBubbleColor: "#6D28D9",
    });
    expect(
      await userB.get({
        clientId: TENANT_A,
        userEmail: "personalization-b@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "default",
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    });
    const [persistedDefaultColors] = await pool.execute<RowDataPacket[]>(
      "SELECT conversation_incoming_bubble_color AS incomingBubbleColor, conversation_outgoing_bubble_color AS outgoingBubbleColor FROM megadesk_user_settings WHERE client_id=? AND user_id=?",
      [TENANT_A, "personalization-user-a"]
    );
    expect(persistedDefaultColors).toEqual([
      { incomingBubbleColor: "#FAE8FF", outgoingBubbleColor: "#6D28D9" },
    ]);
    await userA.save({
      clientId: TENANT_A,
      userEmail: "personalization-a@example.invalid",
      backgroundType: "preset",
      presetId: "solid-blue",
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    });
    await expect(
      userA.save({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
        backgroundType: "default",
        presetId: null,
        incomingBubbleColor: "red",
        outgoingBubbleColor: "#1E293B",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userA.save({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
        backgroundType: "default",
        presetId: null,
        incomingBubbleColor: "var(--brand)",
        outgoingBubbleColor: "#1E293B",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await caller(
        TENANT_A,
        "personalization-user-a",
        "personalization-a@example.invalid"
      ).get({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "preset",
      presetId: "solid-blue",
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    });
    await userA.save({
      clientId: TENANT_A,
      userEmail: "personalization-a@example.invalid",
      backgroundType: "preset",
      presetId: "midnight",
      incomingBubbleColor: "#FEF3C7",
      outgoingBubbleColor: "#0F766E",
    });
    expect(
      await userA.get({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "preset",
      presetId: "midnight",
      incomingBubbleColor: "#FEF3C7",
      outgoingBubbleColor: "#0F766E",
    });
    expect(
      await userB.get({
        clientId: TENANT_A,
        userEmail: "personalization-b@example.invalid",
      })
    ).toMatchObject({ backgroundType: "default" });
    await userB.save({
      clientId: TENANT_A,
      userEmail: "personalization-b@example.invalid",
      backgroundType: "default",
      presetId: null,
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    });
    expect(
      await caller(
        TENANT_A,
        "personalization-user-b",
        "personalization-b@example.invalid"
      ).get({
        clientId: TENANT_A,
        userEmail: "personalization-b@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "default",
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    });
    expect(
      await caller(
        TENANT_A,
        "personalization-user-a",
        "personalization-a@example.invalid"
      ).get({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
      })
    ).toMatchObject({
      backgroundType: "preset",
      presetId: "midnight",
      incomingBubbleColor: "#FEF3C7",
      outgoingBubbleColor: "#0F766E",
    });

    const tenantA = caller(
      TENANT_A,
      "same-logical-user",
      "tenant-user@example.invalid"
    );
    const tenantB = caller(
      TENANT_B,
      "same-logical-user",
      "tenant-user@example.invalid"
    );
    await tenantA.save({
      clientId: TENANT_A,
      userEmail: "tenant-user@example.invalid",
      backgroundType: "preset",
      presetId: "solid-white",
      incomingBubbleColor: "#FEF3C7",
      outgoingBubbleColor: "#1D4ED8",
    });
    await tenantB.save({
      clientId: TENANT_B,
      userEmail: "tenant-user@example.invalid",
      backgroundType: "preset",
      presetId: "solid-black",
      incomingBubbleColor: "#FCE7F3",
      outgoingBubbleColor: "#9F1239",
    });
    await expect(
      tenantA.save({
        clientId: TENANT_B,
        userEmail: "tenant-user@example.invalid",
        backgroundType: "preset",
        presetId: "solid-white",
        incomingBubbleColor: "#FEF3C7",
        outgoingBubbleColor: "#1D4ED8",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await tenantA.get({
        clientId: TENANT_A,
        userEmail: "tenant-user@example.invalid",
      })
    ).toMatchObject({
      presetId: "solid-white",
      outgoingBubbleColor: "#1D4ED8",
    });
    expect(
      await tenantB.get({
        clientId: TENANT_B,
        userEmail: "tenant-user@example.invalid",
      })
    ).toMatchObject({
      presetId: "solid-black",
      outgoingBubbleColor: "#9F1239",
    });

    const mediaRunId = `megadesk-personalization-media-${Date.now()}`;
    const mediaRoot = mkdtempSync(join(tmpdir(), `${mediaRunId}-`));
    const previousRoot = process.env.MEGADESK_MEDIA_ROOT;
    const previousRunId = process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    process.env.MEGADESK_MEDIA_ROOT = mediaRoot;
    process.env.MEGADESK_MEDIA_TEST_RUN_ID = mediaRunId;
    const app = express();
    registerUserPersonalizationRoutes(app);
    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve, reject) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
        instance.once("error", reject);
      }
    );
    try {
      const tokenA = await session("personalization-user-a", TENANT_A);
      const tokenB = await session("personalization-user-b", TENANT_A);
      const image = await sharp({
        create: { width: 24, height: 18, channels: 3, background: "#2563eb" },
      })
        .png()
        .toBuffer();
      const upload = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/user-personalization/background`,
        {
          method: "PUT",
          headers: {
            cookie: `${MEGADESK_SESSION_COOKIE}=${tokenA}`,
            "content-type": "image/png",
            "x-megadesk-incoming-bubble-color": "#E0F2FE",
            "x-megadesk-outgoing-bubble-color": "#075985",
          },
          body: image,
        }
      );
      expect(upload.status).toBe(200);
      await expect(upload.json()).resolves.toMatchObject({
        preference: {
          backgroundType: "custom",
          incomingBubbleColor: "#E0F2FE",
          outgoingBubbleColor: "#075985",
        },
      });
      const [stored] = await pool.execute<RowDataPacket[]>(
        "SELECT conversation_background_type AS backgroundType, conversation_background_image_key AS imageKey, conversation_incoming_bubble_color AS incomingBubbleColor, conversation_outgoing_bubble_color AS outgoingBubbleColor FROM megadesk_user_settings WHERE client_id=? AND user_id=?",
        [TENANT_A, "personalization-user-a"]
      );
      expect(stored[0]).toMatchObject({
        backgroundType: "custom",
        incomingBubbleColor: "#E0F2FE",
        outgoingBubbleColor: "#075985",
      });
      expect(stored[0].imageKey).toMatch(
        /^user-backgrounds\/[0-9a-f]{32}\/[0-9a-f-]{36}\.webp$/
      );
      await userA.save({
        clientId: TENANT_A,
        userEmail: "personalization-a@example.invalid",
        backgroundType: "custom",
        presetId: null,
        incomingBubbleColor: "#DCFCE7",
        outgoingBubbleColor: "#166534",
      });
      expect(
        await userA.get({
          clientId: TENANT_A,
          userEmail: "personalization-a@example.invalid",
        })
      ).toMatchObject({
        backgroundType: "custom",
        incomingBubbleColor: "#DCFCE7",
        outgoingBubbleColor: "#166534",
        hasCustomImage: true,
      });
      const ownRead = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/user-personalization/background`,
        { headers: { cookie: `${MEGADESK_SESSION_COOKIE}=${tokenA}` } }
      );
      expect(ownRead.status).toBe(200);
      expect(ownRead.headers.get("content-type")).toMatch(/^image\/webp/);
      const crossRead = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/user-personalization/background?key=${encodeURIComponent(String(stored[0].imageKey))}`,
        { headers: { cookie: `${MEGADESK_SESSION_COOKIE}=${tokenB}` } }
      );
      expect(crossRead.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
      rmSync(mediaRoot, { recursive: true, force: true });
      if (previousRoot === undefined) delete process.env.MEGADESK_MEDIA_ROOT;
      else process.env.MEGADESK_MEDIA_ROOT = previousRoot;
      if (previousRunId === undefined)
        delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;
      else process.env.MEGADESK_MEDIA_TEST_RUN_ID = previousRunId;
    }
  }, 180_000);
});
