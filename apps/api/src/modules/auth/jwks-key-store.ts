import { importJWK, type JWK } from "jose";

/**
 * Asymmetric algorithms accepted for Supabase access tokens.
 * `none` and every `HS*` algorithm are never accepted.
 */
export const ALLOWED_ALGORITHMS = ["ES256", "RS256"] as const;
export type AllowedAlgorithm = (typeof ALLOWED_ALGORITHMS)[number];

export function isAllowedAlgorithm(value: unknown): value is AllowedAlgorithm {
  return typeof value === "string" && (ALLOWED_ALGORITHMS as readonly string[]).includes(value);
}

/** Result of looking up the key for a token's `kid`. */
export type KeyLookup =
  | { status: "found"; key: CryptoKey; alg: AllowedAlgorithm }
  /** The kid is absent from a key set that was successfully retrieved → 401. */
  | { status: "unknown" }
  /** The kid is not cached and the key set could not be retrieved → 503. */
  | { status: "unavailable" };

export interface JwksKeyStoreOptions {
  jwksUrl: URL;
  /** Abort every JWKS request after this many milliseconds. */
  timeoutMs: number;
  /** Minimum interval between refresh attempts (successful or not). */
  cooldownMs: number;
  /** Lifetime of a successfully fetched key set. */
  maxAgeMs: number;
  /** Upper bound of the backoff interval after consecutive failures. */
  maxBackoffMs?: number;
  /** Maximum number of remembered unknown kids. */
  negativeCacheSize?: number;
  /** Maximum accepted JWKS response size in bytes. */
  maxResponseBytes?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

interface CachedKey {
  key: CryptoKey;
  alg: AllowedAlgorithm;
}

const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_NEGATIVE_CACHE_SIZE = 1000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Supabase JWKS key store with bounded retrieval (spec 03, JWKS Retrieval
 * Hardening). It implements every guarantee itself instead of relying on
 * library defaults:
 *
 * - request timeout (`AbortSignal.timeout`),
 * - single flight (one JWKS request in flight per store),
 * - refresh cooldown with exponential backoff after consecutive failures,
 *   capped, and reset by a successful refresh,
 * - bounded negative cache of unknown kids (oldest evicted),
 * - cache lifetime for the fetched key set,
 * - stale on error (a failed refresh never removes working keys),
 * - fail closed (a key that cannot be retrieved never verifies a token).
 *
 * `jose` is used only to import JWKs as CryptoKeys. Its `createRemoteJWKSet`
 * is not used: it retries a failed fetch on every request (no failure
 * cooldown or backoff), has no negative cache, and does not separate
 * "unknown kid" from "key set unavailable".
 */
export class JwksKeyStore {
  private readonly options: Required<Omit<JwksKeyStoreOptions, "fetch" | "now">>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  /** Last successfully retrieved key set (kept on refresh failure). */
  private keys: Map<string, CachedKey> | null = null;
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private lastAttemptSucceeded = false;
  private consecutiveFailures = 0;
  private inflight: Promise<boolean> | null = null;
  /** kid → expiry time. Map iteration order is insertion order (oldest first). */
  private readonly negativeCache = new Map<string, number>();

  constructor(options: JwksKeyStoreOptions) {
    this.options = {
      jwksUrl: options.jwksUrl,
      timeoutMs: options.timeoutMs,
      cooldownMs: options.cooldownMs,
      maxAgeMs: options.maxAgeMs,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      negativeCacheSize: options.negativeCacheSize ?? DEFAULT_NEGATIVE_CACHE_SIZE,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /** Returns the key for `kid`, refreshing the key set only when allowed. */
  async getKey(kid: string): Promise<KeyLookup> {
    const now = this.now();
    const cached = this.keys?.get(kid);

    // Known kid within the cache lifetime: no network access.
    if (cached !== undefined && now - this.fetchedAt < this.options.maxAgeMs) {
      return { status: "found", ...cached };
    }

    // Unknown kid remembered from a successful refresh: no network access.
    if (cached === undefined && this.isNegativelyCached(kid, now)) {
      return { status: "unknown" };
    }

    const refreshed = await this.refreshIfAllowed();
    return this.resolveAfterRefresh(kid, refreshed);
  }

  /**
   * Joins the in-flight refresh, or starts one if the cooldown has elapsed.
   * Returns `true`/`false` for the outcome of the refresh that was awaited,
   * or `null` if no refresh was allowed (cooldown or backoff).
   */
  private async refreshIfAllowed(): Promise<boolean | null> {
    if (this.inflight !== null) return this.inflight;
    if (this.now() < this.lastAttemptAt + this.currentInterval()) return null;

    this.lastAttemptAt = this.now();
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private resolveAfterRefresh(kid: string, refreshed: boolean | null): KeyLookup {
    const cached = this.keys?.get(kid);

    if (refreshed === true) {
      if (cached !== undefined) return { status: "found", ...cached };
      this.rememberUnknown(kid);
      return { status: "unknown" };
    }

    // Refresh failed, or not allowed yet. Stale on error: known kids keep
    // verifying with the last good key set.
    if (cached !== undefined) return { status: "found", ...cached };

    // No refresh allowed and the last attempt succeeded: the kid is not in
    // the current key set.
    if (refreshed === null && this.lastAttemptSucceeded) {
      this.rememberUnknown(kid);
      return { status: "unknown" };
    }

    // The key set could not be retrieved (or is backing off after a failure).
    return { status: "unavailable" };
  }

  /** Interval before the next refresh may start. */
  private currentInterval(): number {
    if (this.consecutiveFailures === 0) return this.options.cooldownMs;
    const backoff = this.options.cooldownMs * 2 ** (this.consecutiveFailures - 1);
    return Math.min(backoff, this.options.maxBackoffMs);
  }

  private async refresh(): Promise<boolean> {
    try {
      const keys = await this.fetchKeySet();
      this.keys = keys;
      this.fetchedAt = this.now();
      this.consecutiveFailures = 0;
      this.lastAttemptSucceeded = true;
      // Kids that are now published must not stay negatively cached.
      for (const kid of keys.keys()) this.negativeCache.delete(kid);
      return true;
    } catch (error) {
      this.consecutiveFailures += 1;
      this.lastAttemptSucceeded = false;
      // Once per refresh attempt (bounded by the cooldown and backoff). Only a
      // fixed reason is logged: error messages can quote URLs or response data.
      console.warn(`JWKS refresh failed (${this.consecutiveFailures} in a row): ${refreshFailureReason(error)}`);
      return false;
    }
  }

  private async fetchKeySet(): Promise<Map<string, CachedKey>> {
    const response = await this.fetchImpl(this.options.jwksUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new JwksResponseError(`http status ${response.status}`);
    const text = await response.text();
    if (text.length > this.options.maxResponseBytes) throw new JwksResponseError("invalid response");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new JwksResponseError("invalid response");
    }
    if (typeof body !== "object" || body === null || !Array.isArray((body as { keys?: unknown }).keys)) {
      throw new JwksResponseError("invalid response");
    }

    const keys = new Map<string, CachedKey>();
    for (const jwk of (body as { keys: unknown[] }).keys) {
      const imported = await importVerificationKey(jwk);
      if (imported !== null) keys.set(imported.kid, imported.cached);
    }
    return keys;
  }

  private isNegativelyCached(kid: string, now: number): boolean {
    const expiresAt = this.negativeCache.get(kid);
    if (expiresAt === undefined) return false;
    if (expiresAt > now) return true;
    this.negativeCache.delete(kid);
    return false;
  }

  private rememberUnknown(kid: string): void {
    this.negativeCache.delete(kid);
    while (this.negativeCache.size >= this.options.negativeCacheSize) {
      const oldest = this.negativeCache.keys().next();
      if (oldest.done === true) break;
      this.negativeCache.delete(oldest.value);
    }
    this.negativeCache.set(kid, this.now() + this.options.cooldownMs);
  }
}

/** A JWKS response that was received but cannot be used; `reason` is fixed text. */
class JwksResponseError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "JwksResponseError";
  }
}

/** Fixed, non-data-bearing reason for a failed refresh. */
function refreshFailureReason(error: unknown): string {
  if (error instanceof JwksResponseError) return error.reason;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "timeout";
  return "network error";
}

/**
 * Imports one JWK as a verification key. Keys that are not usable for
 * signature verification with an allowed algorithm are skipped.
 */
async function importVerificationKey(
  value: unknown,
): Promise<{ kid: string; cached: CachedKey } | null> {
  if (typeof value !== "object" || value === null) return null;
  const jwk = value as JWK;
  if (typeof jwk.kid !== "string" || jwk.kid.length === 0) return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  // Never import private or symmetric key material.
  if (jwk.kty === "oct" || jwk.d !== undefined || jwk.k !== undefined) return null;

  const alg = jwk.alg ?? inferAlgorithm(jwk);
  if (!isAllowedAlgorithm(alg)) return null;

  try {
    const key = await importJWK({ ...jwk, alg }, alg);
    if (!(key instanceof CryptoKey)) return null;
    return { kid: jwk.kid, cached: { key, alg } };
  } catch {
    return null;
  }
}

function inferAlgorithm(jwk: JWK): string | undefined {
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "RSA") return "RS256";
  return undefined;
}
