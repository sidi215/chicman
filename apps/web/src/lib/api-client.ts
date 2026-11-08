import { AUTH_ERROR_CODES } from "@chicman/shared"

/**
 * Result of an API call, classified for session handling (spec 03):
 * - `unauthorized` (401): the token is invalid → end the session.
 * - `auth-unavailable` (503 AUTH_UNAVAILABLE): neither accepted nor invalid →
 *   keep the session and retry later. Never a logout.
 * - `forbidden` (403): authenticated but not permitted (`code` tells why,
 *   for example `EMAIL_NOT_CONFIRMED`).
 */
export type ApiResult<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "unauthorized" }
  | { kind: "auth-unavailable" }
  | { kind: "forbidden"; code: string | null }
  | { kind: "network-error" }
  | { kind: "error"; status: number; code: string | null }

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "")
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code
    return typeof code === "string" ? code : null
  } catch {
    return null
  }
}

/** Classifies an API response. Exported for tests. */
export async function classifyResponse<T>(response: Response): Promise<ApiResult<T>> {
  if (response.ok) {
    const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T)
    return { kind: "ok", status: response.status, data }
  }
  if (response.status === 401) return { kind: "unauthorized" }
  const code = await readErrorCode(response)
  if (response.status === 403) return { kind: "forbidden", code }
  if (response.status === 503 && code === AUTH_ERROR_CODES.authUnavailable) return { kind: "auth-unavailable" }
  return { kind: "error", status: response.status, code }
}

/** Calls the API with the access token as `Authorization: Bearer <token>`. */
export async function apiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetchImpl(`${getApiBaseUrl()}/api/v1${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${accessToken}`, accept: "application/json" },
    })
  } catch {
    return { kind: "network-error" }
  }
  return classifyResponse<T>(response)
}

export interface PublicRequestOptions {
  /** Overrides the public base URL, for a server that reaches the API on another address. */
  baseUrl?: string | undefined
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** Calls a public API route. No token is attached, so it works for guests. */
export async function publicApiRequest<T>(path: string, fetchImpl: typeof fetch = fetch, options: PublicRequestOptions = {}): Promise<ApiResult<T>> {
  const baseUrl = options.baseUrl?.replace(/\/+$/, "") || getApiBaseUrl()
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      headers: { ...options.headers, accept: "application/json" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    return { kind: "network-error" }
  }
  return classifyResponse<T>(response)
}
