import type { AppConfig } from "../../config/env.js";
import { SupabaseEmailConfirmationChecker } from "./email-confirmation.js";
import { JwksKeyStore } from "./jwks-key-store.js";
import { TokenVerifier } from "./token-verifier.js";

export { createAuthGuards, type AuthDependencies, type AuthGuards } from "./auth.guards.js";
export { createAuthRouter } from "./auth.routes.js";
export { AuthenticationError } from "./auth.errors.js";
export {
  SupabaseEmailConfirmationChecker,
  type EmailConfirmationChecker,
} from "./email-confirmation.js";
export { JwksKeyStore, ALLOWED_ALGORITHMS } from "./jwks-key-store.js";
export { TokenVerifier, CLOCK_TOLERANCE_SECONDS, type VerifiedIdentity } from "./token-verifier.js";

/** Builds the token verifier from validated configuration. */
export function createTokenVerifier(config: AppConfig["supabase"]): TokenVerifier {
  const keyStore = new JwksKeyStore({
    jwksUrl: config.jwksUrl,
    timeoutMs: config.jwksTimeoutMs,
    cooldownMs: config.jwksCooldownMs,
    maxAgeMs: config.jwksMaxAgeMs,
  });
  return new TokenVerifier({ keyStore, issuer: config.jwtIssuer, audience: config.jwtAudience });
}

/** Builds the server-side email-confirmation check from validated configuration. */
export function createEmailConfirmationChecker(config: AppConfig["supabase"]): SupabaseEmailConfirmationChecker {
  return new SupabaseEmailConfirmationChecker({
    supabaseUrl: config.url,
    publishableKey: config.publishableKey,
    timeoutMs: config.authTimeoutMs,
  });
}
