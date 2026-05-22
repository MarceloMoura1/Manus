/**
 * Sistema de cache e rate limiting para Evolution API
 * Otimiza performance e protege contra abuso
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // Janela de tempo em ms
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Cache simples em memória com TTL
 */
class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTtlMs = 5 * 60 * 1000; // 5 minutos

  set(key: string, value: T, ttlMs?: number) {
    const expiresAt = Date.now() + (ttlMs || this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Limpar entradas expiradas periodicamente
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Rate limiter com sliding window
 */
class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxRequests: 100, windowMs: 60000 }) {
    this.config = config;

    // Limpar entradas expiradas a cada minuto
    setInterval(() => this.cleanup(), 60000);
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    let entry = this.limits.get(key);

    if (!entry || now > entry.resetAt) {
      // Nova janela
      entry = {
        count: 1,
        resetAt: now + this.config.windowMs,
      };
      this.limits.set(key, entry);
      return true;
    }

    if (entry.count < this.config.maxRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  getRemainingRequests(key: string): number {
    const entry = this.limits.get(key);
    if (!entry) return this.config.maxRequests;

    if (Date.now() > entry.resetAt) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - entry.count);
  }

  getResetTime(key: string): number {
    const entry = this.limits.get(key);
    if (!entry) return 0;

    return Math.max(0, entry.resetAt - Date.now());
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }
}

/**
 * Cache de sessões
 */
const sessionCache = new MemoryCache<{
  clientId: string;
  status: "connected" | "disconnected" | "connecting";
  phoneNumber?: string;
  instanceId?: string;
  lastUpdated: number;
}>();

/**
 * Cache de configurações de cliente
 */
const configCache = new MemoryCache<{
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  autoRetryEnabled: boolean;
}>();

/**
 * Cache de conversas recentes
 */
const conversationCache = new MemoryCache<{
  conversationId: string;
  clientId: string;
  phoneNumber: string;
  lastMessage: string;
  lastMessageTime: number;
}>();

/**
 * Rate limiters por cliente
 */
const clientRateLimiters = new Map<string, RateLimiter>();

/**
 * Obter rate limiter para cliente
 */
function getClientRateLimiter(clientId: string): RateLimiter {
  if (!clientRateLimiters.has(clientId)) {
    // 1000 mensagens por minuto por cliente
    clientRateLimiters.set(
      clientId,
      new RateLimiter({ maxRequests: 1000, windowMs: 60000 })
    );
  }
  return clientRateLimiters.get(clientId)!;
}

/**
 * Cache de sessão
 */
export function cacheSession(
  clientId: string,
  status: "connected" | "disconnected" | "connecting",
  phoneNumber?: string,
  instanceId?: string
) {
  const key = `session:${clientId}`;
  sessionCache.set(
    key,
    {
      clientId,
      status,
      phoneNumber,
      instanceId,
      lastUpdated: Date.now(),
    },
    10 * 60 * 1000 // 10 minutos
  );
}

/**
 * Obter sessão em cache
 */
export function getCachedSession(clientId: string) {
  const key = `session:${clientId}`;
  return sessionCache.get(key);
}

/**
 * Limpar cache de sessão
 */
export function clearSessionCache(clientId: string) {
  const key = `session:${clientId}`;
  sessionCache.delete(key);
}

/**
 * Cache de configuração
 */
export function cacheClientConfig(clientId: string, config: any) {
  const key = `config:${clientId}`;
  configCache.set(key, config, 30 * 60 * 1000); // 30 minutos
}

/**
 * Obter configuração em cache
 */
export function getCachedClientConfig(clientId: string) {
  const key = `config:${clientId}`;
  return configCache.get(key);
}

/**
 * Cache de conversa
 */
export function cacheConversation(
  clientId: string,
  conversationId: string,
  phoneNumber: string,
  lastMessage: string
) {
  const key = `conv:${clientId}:${conversationId}`;
  conversationCache.set(
    key,
    {
      conversationId,
      clientId,
      phoneNumber,
      lastMessage,
      lastMessageTime: Date.now(),
    },
    15 * 60 * 1000 // 15 minutos
  );
}

/**
 * Obter conversa em cache
 */
export function getCachedConversation(clientId: string, conversationId: string) {
  const key = `conv:${clientId}:${conversationId}`;
  return conversationCache.get(key);
}

/**
 * Verificar rate limit
 */
export function checkRateLimit(clientId: string): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const limiter = getClientRateLimiter(clientId);
  const allowed = limiter.isAllowed(clientId);
  const remaining = limiter.getRemainingRequests(clientId);
  const resetIn = limiter.getResetTime(clientId);

  return { allowed, remaining, resetIn };
}

/**
 * Limpar todos os caches
 */
export function clearAllCaches() {
  sessionCache.clear();
  configCache.clear();
  conversationCache.clear();
  clientRateLimiters.clear();
}

/**
 * Obter estatísticas de cache
 */
export function getCacheStats() {
  return {
    sessions: sessionCache["cache"].size,
    configs: configCache["cache"].size,
    conversations: conversationCache["cache"].size,
    rateLimiters: clientRateLimiters.size,
  };
}

/**
 * Inicializar limpeza periódica de cache
 */
export function initializeCacheCleanup(intervalMs: number = 5 * 60 * 1000) {
  setInterval(() => {
    sessionCache.cleanup();
    configCache.cleanup();
    conversationCache.cleanup();
    console.log("[Cache] Limpeza periódica executada");
  }, intervalMs);
}
