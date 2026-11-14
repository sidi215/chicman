import type { AccountSessionResponse } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/**
 * What the client does with the API session check (spec 03):
 * - `active`: the API accepted the token.
 * - `signed-out`: 401 — the token is invalid; the local session is ended.
 * - `unavailable`: 503 AUTH_UNAVAILABLE or a network error — keep the
 *   session and retry later (never a logout).
 * - `not-bootstrapped`: 403 — valid token without an account yet: setup is not done (AT-1).
 */
export type SessionCheck =
  | { state: "active"; session: AccountSessionResponse }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "not-bootstrapped" }
  | { state: "error" }

export function interpretSessionCheck(result: ApiResult<AccountSessionResponse>): SessionCheck {
  switch (result.kind) {
    case "ok":
      return { state: "active", session: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "forbidden":
      return { state: "not-bootstrapped" }
    case "error":
      return { state: "error" }
  }
}

/** Only a 401 ends the session. */
export function shouldEndSession(check: SessionCheck): boolean {
  return check.state === "signed-out"
}
