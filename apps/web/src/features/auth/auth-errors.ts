import type { AuthErrorKey } from "./messages"

/**
 * Maps a Supabase Auth error (code or status) to a message key. Messages
 * never reveal whether an email address is registered.
 */
export function authErrorKey(error: unknown): AuthErrorKey {
  if (typeof error !== "object" || error === null) return "generic"
  const { code, status, name, message } = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }
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
  // supabase-js reports every 5xx from Supabase as AuthRetryableFetchError
  // with that status, and a real network failure with status 0. A server
  // error must never be shown as the customer's network (production sign-up,
  // 2026-11-24: "Error sending confirmation email" read "check your network").
  if (typeof status === "number" && status >= 500) {
    return typeof message === "string" && /error sending .*email/i.test(message) ? "emailSendFailed" : "serviceUnavailable"
  }
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
