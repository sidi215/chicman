import { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends (for `Retry-After`). */
  retryAfterSeconds: number;
}

/** Fixed-window counter: at most `limit` hits per `windowMs` per key. */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/**
 * Redis counters (architecture.md, Storage Model). `INCR` and `PEXPIRE … NX`
 * run in one transaction, so a window always gets an expiry.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    /** Key namespace; tests use their own so they never touch real counters. */
    private readonly prefix = "chicman:rl:",
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}${key}`;
    const results = await this.redis.multi().incr(redisKey).pexpire(redisKey, windowMs, "NX").pttl(redisKey).exec();
    if (results === null) throw new Error("Rate-limit transaction aborted");
    const [incr, , ttl] = results;
    if (incr?.[0] || ttl?.[0]) throw incr?.[0] ?? ttl?.[0];
    const count = Number(incr?.[1]);
    const ttlMs = Math.max(Number(ttl?.[1]), 0);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(Math.ceil(ttlMs / 1000), 1) };
  }
}

/** In-process counters for tests and local development without Redis. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    let window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (this.windows.size > 10_000) this.evictExpired(now);
    return { allowed: window.count <= limit, retryAfterSeconds: Math.max(Math.ceil((window.resetAt - now) / 1000), 1) };
  }

  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

/**
 * Redis first; if Redis fails, the same limits are enforced with in-process
 * counters, so protection is never switched off. Per-process counters are
 * weaker with several API instances (each counts separately); every fallback
 * is reported, at most once a minute, without request data.
 */
export class FallbackRateLimiter implements RateLimiter {
  private lastWarning = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter = new MemoryRateLimiter(),
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
      return await this.primary.hit(key, limit, windowMs);
    } catch {
      if (this.now() - this.lastWarning >= 60_000) {
        this.lastWarning = this.now();
        this.warn("Rate limiter: Redis unavailable; enforcing limits with in-process counters.");
      }
      return this.fallback.hit(key, limit, windowMs);
    }
  }
}

export function createRedisClient(url: string): Redis {
  // Fail fast instead of queueing commands while Redis is down; the rate-limit
  // middleware then lets requests through (see middleware/rate-limit.ts).
  return new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
}
