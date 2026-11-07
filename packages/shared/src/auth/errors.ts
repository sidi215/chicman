/**
 * Error codes returned by the API for authentication and authorization.
 *
 * - `UNAUTHORIZED` (401): credentials are invalid. The body never says which
 *   check failed. Clients end the session.
 * - `AUTH_UNAVAILABLE` (503): key material could not be retrieved; the token
 *   was neither accepted nor found invalid. Clients keep the session and
 *   retry later — this is never a logout.
 * - `FORBIDDEN` (403): authenticated but not permitted.
 */
export const AUTH_ERROR_CODES = {
  unauthorized: "UNAUTHORIZED",
  authUnavailable: "AUTH_UNAVAILABLE",
  forbidden: "FORBIDDEN",
  /** 403 from bootstrap: the Supabase identity's email is not confirmed. */
  emailNotConfirmed: "EMAIL_NOT_CONFIRMED",
} as const;

/**
 * Other stable API error codes.
 *
 * - `BAD_REQUEST` (400): invalid body (unknown or protected field, bad value).
 * - `INVALID_PHONE` (400): the phone number is not a valid E.164 number.
 * - `NOT_FOUND` (404), `PROFILE_NOT_FOUND` (404): no such resource.
 * - `RATE_LIMITED` (429): too many requests; see `Retry-After`.
 * - `SERVICE_UNAVAILABLE` (503): temporary failure, retry later: the
 *   database is temporarily unreachable or overloaded, a rate limiter failed,
 *   or bootstrap conflicts persisted after the bounded retries.
 * - `INTERNAL_ERROR` (500): unexpected error (programming error, database
 *   misconfiguration, query error). Never retried automatically.
 */
export const API_ERROR_CODES = {
  badRequest: "BAD_REQUEST",
  invalidPhone: "INVALID_PHONE",
  notFound: "NOT_FOUND",
  profileNotFound: "PROFILE_NOT_FOUND",
  rateLimited: "RATE_LIMITED",
  serviceUnavailable: "SERVICE_UNAVAILABLE",
  internalError: "INTERNAL_ERROR",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/** Error response body used by every API error. */
export interface ApiErrorBody {
  error: { code: string };
}
