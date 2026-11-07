import { API_ERROR_CODES, AUTH_ERROR_CODES, type CustomerProfileResponse } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/** What the account-setup screen does with the bootstrap response (spec 04). */
export type SetupOutcome =
  | { state: "done"; account: CustomerProfileResponse }
  | { state: "invalid-phone" }
  | { state: "email-not-confirmed" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "rate-limited" }
  | { state: "error" }

export function interpretSetupResult(result: ApiResult<CustomerProfileResponse>): SetupOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "done", account: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "forbidden":
      return result.code === AUTH_ERROR_CODES.emailNotConfirmed ? { state: "email-not-confirmed" } : { state: "error" }
    case "error":
      if (result.status === 400 && result.code === API_ERROR_CODES.invalidPhone) return { state: "invalid-phone" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}
