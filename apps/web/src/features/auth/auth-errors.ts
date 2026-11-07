import type { AuthErrorKey } from "./messages"

/**
 * Maps a Supabase Auth error (code or status) to a message key. Messages
 * never reveal whether an email address is registered.
 */
export function authErrorKey(error: unknown): AuthErrorKey {
  if (typeof error !== "object" || error === null) return "generic"
  const { code, status, name } = error as { code?: unknown; status?: unknown; name?: unknown }
  switch (code) {
    case "invalid_credentials":
      return "invalidCredentials"
    case "email_not_confirmed":
      return "emailNotConfirmed"
    case "weak_password":
      return "weakPassword"
    case "same_password":
      return "samePassword"
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rateLimited"
    case "captcha_failed":
      return "captchaFailed"
    case "email_address_invalid":
    case "validation_failed":
      return "invalidEmail"
  }
  if (status === 429) return "rateLimited"
  if (name === "AuthRetryableFetchError") return "network"
  return "generic"
}

/**
 * Sign-up errors that must look like success, so the response never reveals
 * whether the email is already registered (spec 03, no account enumeration).
 */
export function isEnumerationSensitive(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const { code } = error as { code?: unknown }
  return code === "user_already_exists" || code === "email_exists"
}
