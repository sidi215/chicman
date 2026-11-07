import { decodeProtectedHeader, jwtVerify } from "jose";

import { isAllowedAlgorithm, type JwksKeyStore } from "./jwks-key-store.js";
import { AuthenticationError } from "./auth.errors.js";

/** Maximum clock tolerance for `exp`, `nbf`, and `iat` (spec 03). */
export const CLOCK_TOLERANCE_SECONDS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Identity established by a verified access token. */
export interface VerifiedIdentity {
  /** The verified `sub`: the Supabase Auth user ID. The only identity input. */
  supabaseUserId: string;
}

export interface TokenVerifierOptions {
  keyStore: JwksKeyStore;
  issuer: string;
  audience: string;
  now?: () => number;
}

/**
 * Verifies Supabase access tokens (spec 03, Access-Token Verification
 * Contract): signature against the JWKS (ES256/RS256 only), issuer,
 * audience, expiry (±30 s), `nbf`/`iat`, and a UUID `sub`.
 *
 * Throws `AuthenticationError("invalid")` (→ 401) or
 * `AuthenticationError("unavailable")` (→ 503) and never returns an
 * unverified payload.
 */
export class TokenVerifier {
  constructor(private readonly options: TokenVerifierOptions) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    if (!COMPACT_JWS.test(token)) throw new AuthenticationError("invalid");

    // The header is read only to select a key. Its algorithm is checked
    // against the allowlist and must also match the key's own algorithm.
    let alg: unknown;
    let kid: unknown;
    try {
      ({ alg, kid } = decodeProtectedHeader(token));
    } catch {
      throw new AuthenticationError("invalid");
    }
    if (!isAllowedAlgorithm(alg)) throw new AuthenticationError("invalid");
    if (typeof kid !== "string" || kid.length === 0) throw new AuthenticationError("invalid");

    const lookup = await this.options.keyStore.getKey(kid);
    if (lookup.status === "unavailable") throw new AuthenticationError("unavailable");
    if (lookup.status === "unknown") throw new AuthenticationError("invalid");
    if (lookup.alg !== alg) throw new AuthenticationError("invalid");

    const now = this.options.now?.() ?? Date.now();
    let payload;
    try {
      ({ payload } = await jwtVerify(token, lookup.key, {
        algorithms: [lookup.alg],
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ["exp", "sub"],
        currentDate: new Date(now),
      }));
    } catch {
      throw new AuthenticationError("invalid");
    }

    // jose checks `exp` and `nbf`; `iat` must not be in the future either.
    const nowSeconds = Math.floor(now / 1000);
    if (payload.iat !== undefined && payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
      throw new AuthenticationError("invalid");
    }
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) {
      throw new AuthenticationError("invalid");
    }

    return { supabaseUserId: payload.sub.toLowerCase() };
  }
}
