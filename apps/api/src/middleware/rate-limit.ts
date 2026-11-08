import type { Request, RequestHandler } from "express";

import { HttpError, serviceUnavailable } from "../lib/http-error.js";
import type { RateLimiter } from "../lib/rate-limiter.js";

export interface RateLimitRule {
  /** Counter name, for example `bootstrap`. */
  name: string;
  /** Requests allowed per user (verified `sub`) per window. */
  perUser: number;
  /** Requests allowed per client IP address per window. */
  perIp: number;
  windowMs: number;
}

/** 429 with `Retry-After`. */
export class RateLimitError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "RATE_LIMITED");
  }
}

/**
 * Per-user and per-IP limits (spec 03, Abuse Protection). Runs after
 * `authenticate`, so the user key is the verified `sub`, never client input.
 *
 * The limiter is expected to handle its own store failures (see
 * `FallbackRateLimiter`). If it still throws, the request is refused with
 * `503` (fail closed): rate limiting is never silently switched off.
 *
 * `clientAddress` replaces `req.ip` for a request made on a customer's behalf.
 * It must only return an address from an authenticated source.
 */
export function rateLimit(limiter: RateLimiter, rule: RateLimitRule, clientAddress?: (req: Request) => string | undefined): RequestHandler {
  return async (req, _res, next) => {
    const address = clientAddress?.(req) ?? req.ip ?? "unknown";
    const keys: [string, number][] = [[`${rule.name}:ip:${address}`, rule.perIp]];
    if (req.auth !== undefined) keys.push([`${rule.name}:user:${req.auth.supabaseUserId}`, rule.perUser]);
    for (const [key, limit] of keys) {
      let result;
      try {
        result = await limiter.hit(key, limit, rule.windowMs);
      } catch {
        throw serviceUnavailable();
      }
      if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
    }
    next();
  };
}
