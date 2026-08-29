import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { CookieOptions, Request, Response } from "express";
import { getPool } from "../db";

export const MEGADESK_SESSION_COOKIE = "megadesk_session";
const DEFAULT_SESSION_HOURS = 8;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export type OperationalIdentity = {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: "admin" | "manager" | "agent" | "viewer";
  permissions: string[];
  userEmail: string;
};

export type StoredOperationalSession = OperationalIdentity & {
  tokenHash: string;
  sessionVersion: number;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  tenantStatus: string;
  accessReleased: boolean;
  userStatus: string;
};

export type NewOperationalSession = {
  id: string;
  tokenHash: string;
  userId: string;
  clientId: string;
  sessionVersion: number;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
};

export interface OperationalSessionRepository {
  replaceForIdentity(session: NewOperationalSession, revokedAt: Date): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredOperationalSession | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean>;
  touch(sessionId: string, lastUsedAt: Date): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  return result[0].filter(isRecord);
}

function dateValue(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_SESSION_TIMESTAMP");
  return parsed;
}

function parsePermissions(value: unknown): string[] {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class MysqlOperationalSessionRepository implements OperationalSessionRepository {
  async replaceForIdentity(session: NewOperationalSession, revokedAt: Date): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "UPDATE megadesk_operational_sessions SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
        [revokedAt, session.userId, session.clientId],
      );
      await connection.execute(
        "INSERT INTO megadesk_operational_sessions (id, token_hash, user_id, client_id, session_version, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [session.id, session.tokenHash, session.userId, session.clientId, session.sessionVersion, session.createdAt, session.expiresAt, session.lastUsedAt],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findByTokenHash(tokenHash: string): Promise<StoredOperationalSession | null> {
    const rows = resultRows(await getPool().execute(
      `SELECT s.id, s.token_hash, s.user_id, s.client_id, s.session_version, s.created_at, s.expires_at, s.last_used_at, s.revoked_at,
              u.email, u.role, u.status AS user_status, u.permissions_json,
              c.status AS tenant_status, c.access_released
       FROM megadesk_operational_sessions s
       INNER JOIN megadesk_domain_client_users u ON u.user_id = s.user_id AND u.client_id = s.client_id
       INNER JOIN megadesk_domain_clients c ON c.client_id = s.client_id
       WHERE s.token_hash = ? LIMIT 2`,
      [tokenHash],
    ));
    if (rows.length !== 1) return null;
    const row = rows[0];
    const role = row.role;
    if (role !== "admin" && role !== "manager" && role !== "agent" && role !== "viewer") return null;
    return {
      sessionId: String(row.id),
      tokenHash: String(row.token_hash),
      userId: String(row.user_id),
      tenantId: String(row.client_id),
      sessionVersion: Number(row.session_version),
      createdAt: dateValue(row.created_at),
      expiresAt: dateValue(row.expires_at),
      lastUsedAt: dateValue(row.last_used_at),
      revokedAt: row.revoked_at == null ? null : dateValue(row.revoked_at),
      userEmail: String(row.email).trim().toLowerCase(),
      role,
      permissions: parsePermissions(row.permissions_json),
      userStatus: String(row.user_status),
      tenantStatus: String(row.tenant_status),
      accessReleased: Number(row.access_released) === 1,
    };
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const result = await getPool().execute(
      "UPDATE megadesk_operational_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      [revokedAt, tokenHash],
    );
    if (!Array.isArray(result) || !isRecord(result[0])) return false;
    return Number(result[0].affectedRows ?? 0) > 0;
  }

  async touch(sessionId: string, lastUsedAt: Date): Promise<void> {
    await getPool().execute("UPDATE megadesk_operational_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL", [lastUsedAt, sessionId]);
  }
}

export class MemoryOperationalSessionRepository implements OperationalSessionRepository {
  readonly sessions = new Map<string, StoredOperationalSession>();
  async replaceForIdentity(session: NewOperationalSession, revokedAt: Date) {
    for (const existing of this.sessions.values()) if (existing.userId === session.userId && existing.tenantId === session.clientId && !existing.revokedAt) existing.revokedAt = revokedAt;
    this.sessions.set(session.tokenHash, {
      sessionId: session.id, tokenHash: session.tokenHash, userId: session.userId, tenantId: session.clientId,
      sessionVersion: session.sessionVersion, createdAt: session.createdAt, expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt, revokedAt: null, role: "admin", permissions: [], userEmail: "test@example.invalid",
      tenantStatus: "active", accessReleased: true, userStatus: "active",
    });
  }
  async findByTokenHash(tokenHash: string) { return this.sessions.get(tokenHash) ?? null; }
  async revokeByTokenHash(tokenHash: string, revokedAt: Date) { const session = this.sessions.get(tokenHash); if (!session || session.revokedAt) return false; session.revokedAt = revokedAt; return true; }
  async touch(sessionId: string, lastUsedAt: Date) { for (const session of this.sessions.values()) if (session.sessionId === sessionId) session.lastUsedAt = lastUsedAt; }
}

const runtimeRepository = new MysqlOperationalSessionRepository();
export const testOperationalSessionRepository = new MemoryOperationalSessionRepository();

function defaultRepository(): OperationalSessionRepository {
  return process.env.NODE_ENV === "test" && process.env.RUN_DATABASE_INTEGRATION !== "1"
    ? testOperationalSessionRepository
    : runtimeRepository;
}

export function hashOperationalSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readOperationalSessionToken(req: Pick<Request, "headers">): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const value = parseCookieHeader(header)[MEGADESK_SESSION_COOKIE];
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function sessionDurationMs(): number {
  const raw = process.env.MEGADESK_SESSION_TTL_HOURS;
  if (!raw) return DEFAULT_SESSION_HOURS * 60 * 60 * 1000;
  const hours = Number(raw);
  if (Number.isFinite(hours) && hours >= 1 && hours <= 24 * 30) return hours * 60 * 60 * 1000;
  if (process.env.NODE_ENV === "production") throw new Error("MEGADESK_SESSION_TTL_HOURS inválido");
  return DEFAULT_SESSION_HOURS * 60 * 60 * 1000;
}

export function operationalCookieOptions(req: Pick<Request, "secure">): CookieOptions {
  return {
    httpOnly: true,
    secure: req.secure || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationMs(),
  };
}

export async function createOperationalSession(
  input: { userId: string; clientId: string },
  response: Response,
  request: Request,
  repository: OperationalSessionRepository = defaultRepository(),
  tokenFactory: () => string = () => randomBytes(32).toString("base64url"),
) {
  const token = tokenFactory();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("INVALID_OPERATIONAL_SESSION_TOKEN");
  const tokenHash = hashOperationalSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDurationMs());
  await repository.replaceForIdentity({ id: randomUUID(), tokenHash, userId: input.userId, clientId: input.clientId, sessionVersion: 1, createdAt: now, expiresAt, lastUsedAt: now }, now);
  response.cookie(MEGADESK_SESSION_COOKIE, token, operationalCookieOptions(request));
  return { expiresAt };
}

export async function resolveOperationalSession(req: Pick<Request, "headers">, repository: OperationalSessionRepository = defaultRepository(), now = new Date()): Promise<OperationalIdentity | null> {
  const token = readOperationalSessionToken(req);
  if (!token) return null;
  const session = await repository.findByTokenHash(hashOperationalSessionToken(token));
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.tenantStatus !== "active" || !session.accessReleased || session.userStatus !== "active") return null;
  if (now.getTime() - session.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) await repository.touch(session.sessionId, now);
  return { sessionId: session.sessionId, userId: session.userId, tenantId: session.tenantId, role: session.role, permissions: session.permissions, userEmail: session.userEmail };
}

/** Authentication-only variant for endpoints that must never write while resolving a session. */
export async function resolveOperationalSessionReadOnly(req: Pick<Request, "headers">, repository: OperationalSessionRepository = defaultRepository(), now = new Date()): Promise<OperationalIdentity | null> {
  const token = readOperationalSessionToken(req);
  if (!token) return null;
  const session = await repository.findByTokenHash(hashOperationalSessionToken(token));
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.tenantStatus !== "active" || !session.accessReleased || session.userStatus !== "active") return null;
  return { sessionId: session.sessionId, userId: session.userId, tenantId: session.tenantId, role: session.role, permissions: session.permissions, userEmail: session.userEmail };
}

export async function revokeOperationalSession(req: Pick<Request, "headers">, repository: OperationalSessionRepository = defaultRepository()): Promise<boolean> {
  const token = readOperationalSessionToken(req);
  if (!token) return false;
  return repository.revokeByTokenHash(hashOperationalSessionToken(token), new Date());
}

export function clearOperationalSessionCookie(response: Response, request: Request): void {
  const { maxAge: _maxAge, ...options } = operationalCookieOptions(request);
  response.clearCookie(MEGADESK_SESSION_COOKIE, options);
}

export function operationalAllowedOrigins(): Set<string> {
  const configured = process.env.MEGADESK_ALLOWED_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  if (configured.length) return new Set(configured);
  if (process.env.NODE_ENV === "production") return new Set();
  return new Set(["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"]);
}

export function assertOperationalCsrf(req: Pick<Request, "headers">): void {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  let candidate: string | null = typeof origin === "string" ? origin : null;
  if (!candidate && typeof referer === "string") {
    try { candidate = new URL(referer).origin; } catch { candidate = null; }
  }
  if (!candidate && process.env.NODE_ENV !== "production") return;
  if (!candidate || !operationalAllowedOrigins().has(candidate)) throw new Error("CSRF_ORIGIN_DENIED");
}
