/**
 * Confirmation and recovery link handling (spec 03, `/auth/callback`).
 * The token hash arrives in the URL fragment, so it never reaches a server.
 */

export type EmailLinkType = "email" | "recovery"

/**
 * A verified-later email link. Two formats are accepted:
 * - `token-hash`: Chicman's custom templates (`#token_hash=…&type=email|recovery`);
 *   the client verifies the hash with Supabase.
 * - `session`: Supabase's default templates. Supabase verifies the link on its
 *   own endpoint, then redirects with `#access_token=…&refresh_token=…&type=signup|recovery`;
 *   the client hands the tokens to Supabase (`setSession`), which checks them.
 *   Used while the default email provider is in place (no custom SMTP yet).
 */
export type EmailLink =
  | { kind: "token-hash"; tokenHash: string; type: EmailLinkType }
  | { kind: "session"; accessToken: string; refreshToken: string; type: EmailLinkType }

const TOKEN_HASH = /^[A-Za-z0-9_-]{8,512}$/
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{8,512}$/

/**
 * Parses the callback fragment. Anything else (missing or malformed token,
 * another type, a Supabase error fragment) → `null`, which shows the
 * invalid-link screen. No redirect parameter is ever read.
 */
export function parseEmailLinkFragment(hash: string): EmailLink | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash)
  if (params.has("error") || params.has("error_code")) return null
  const type = params.get("type")

  const tokenHash = params.get("token_hash")
  if (tokenHash !== null) {
    if (!TOKEN_HASH.test(tokenHash)) return null
    if (type !== "email" && type !== "recovery") return null
    return { kind: "token-hash", tokenHash, type }
  }

  const accessToken = params.get("access_token")
  const refreshToken = params.get("refresh_token")
  if (accessToken === null || refreshToken === null) return null
  if (accessToken.length > 8192 || !JWT.test(accessToken) || !REFRESH_TOKEN.test(refreshToken)) return null
  const linkType: EmailLinkType | null = type === "signup" ? "email" : type === "recovery" ? "recovery" : null
  if (linkType === null) return null
  return { kind: "session", accessToken, refreshToken, type: linkType }
}

/** Fixed destinations after a successful verification. */
export const CALLBACK_DESTINATIONS: Record<EmailLinkType, string> = {
  email: "/account",
  recovery: "/auth/update-password",
}

/** Site URL from configuration; the callback is always `<SITE_URL>/auth/callback`. */
export function getSiteUrl(origin?: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  return (configured && configured.length > 0 ? configured : (origin ?? "")).replace(/\/+$/, "")
}

export function getAuthCallbackUrl(origin?: string): string {
  return `${getSiteUrl(origin)}/auth/callback`
}
