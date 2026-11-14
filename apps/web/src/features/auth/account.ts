import {
  ACCOUNT_ERROR_CODES,
  API_ERROR_CODES,
  AUTH_ERROR_CODES,
  type AccountProfileResponse,
  type AccountType,
  type RegistrableAccountType,
} from "@chicman/shared"

import { classifyResponse, getApiBaseUrl, type ApiResult } from "@/lib/api-client"

import type { SessionCheck } from "./session-check"

/**
 * The signed-in account on the web (AT-1, `context/account-types-audit.md`
 * section 12). The type comes from `GET /auth/session`, which reads it from
 * PostgreSQL; the client only routes with it. The API authorizes every request.
 */
export type AccountState =
  | { state: "loading" }
  | { state: "guest" }
  /** Signed in, email confirmed, but account setup is not done yet. */
  | { state: "needs-setup" }
  | { state: "active"; userId: string; accountType: AccountType }
  | { state: "unavailable" }
  | { state: "error" }

export function accountFromSessionCheck(check: SessionCheck): AccountState {
  switch (check.state) {
    case "active":
      return { state: "active", userId: check.session.userId, accountType: check.session.accountType }
    case "not-bootstrapped":
      return { state: "needs-setup" }
    case "signed-out":
      return { state: "guest" }
    case "unavailable":
      return { state: "unavailable" }
    case "error":
      return { state: "error" }
  }
}

/** Where each type lands after sign-in, and where another area sends it. */
export const ACCOUNT_HOME: Record<AccountType, string> = {
  BUYER: "/account",
  SELLER: "/seller",
  ADMIN: "/admin/shops",
}

export const ACCOUNT_SETUP_HREF = "/account/setup"

/**
 * The areas of the web app. `profile` is open to every type (Q2); `setup` only
 * to a signed-in identity without an account; the others to one type.
 */
export type AccountArea = "buyer" | "seller" | "admin" | "profile" | "setup"

const AREA_TYPES: Record<Exclude<AccountArea, "setup">, readonly AccountType[]> = {
  buyer: ["BUYER"],
  seller: ["SELLER"],
  admin: ["ADMIN"],
  profile: ["BUYER", "SELLER", "ADMIN"],
}

export type AreaDecision = { kind: "render" } | { kind: "loading" } | { kind: "redirect"; to: string } | { kind: "failed"; reason: "unavailable" | "error" }

/** What a page of `area` does for the current account. A wrong type goes to its own home. */
export function areaDecision(area: AccountArea, account: AccountState): AreaDecision {
  switch (account.state) {
    case "loading":
      return { kind: "loading" }
    case "guest":
      return { kind: "redirect", to: "/login" }
    case "unavailable":
    case "error":
      return { kind: "failed", reason: account.state }
    case "needs-setup":
      return area === "setup" ? { kind: "render" } : { kind: "redirect", to: ACCOUNT_SETUP_HREF }
    case "active":
      if (area === "setup") return { kind: "redirect", to: ACCOUNT_HOME[account.accountType] }
      return AREA_TYPES[area].includes(account.accountType) ? { kind: "render" } : { kind: "redirect", to: ACCOUNT_HOME[account.accountType] }
  }
}

/** Whether the storefront shows buyer actions (cart, favorites, buy) to this account (Q6: others browse read only). */
export const isBuyer = (account: AccountState): boolean => account.state === "active" && account.accountType === "BUYER"

// ---------------------------------------------------------------------------
// Registration intent (section 5.3) and setup
// ---------------------------------------------------------------------------

export const REGISTRATION_INTENT_PATH = "/registration-intents"
export const OWN_INTENT_PATH = "/registration-intents/me"
export const ACCOUNT_SETUP_PATH = "/accounts/me/setup"
export const ACCOUNT_PATH = "/accounts/me"

export type IntentOutcome = "recorded" | "conflict" | "failed"

/**
 * Records the chosen type right after sign-up, before any session exists.
 * Write-once on the server; a failure is not fatal: the setup screen asks
 * again and records the choice.
 */
export async function recordRegistrationIntent(
  supabaseUserId: string,
  accountType: RegistrableAccountType,
  fetchImpl: typeof fetch = fetch
): Promise<IntentOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${getApiBaseUrl()}/api/v1${REGISTRATION_INTENT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ supabaseUserId, accountType }),
    })
  } catch {
    return "failed"
  }
  if (response.status === 204) return "recorded"
  const result = await classifyResponse<unknown>(response)
  return result.kind === "error" && result.code === ACCOUNT_ERROR_CODES.registrationIntentConflict ? "conflict" : "failed"
}

/** What the setup screen does with `POST /accounts/me/setup`. */
export type SetupOutcome =
  | { state: "done"; account: AccountProfileResponse }
  | { state: "invalid-phone" }
  | { state: "invalid" }
  | { state: "email-not-confirmed" }
  | { state: "intent-required" }
  | { state: "type-conflict" }
  | { state: "shop-exists" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "rate-limited" }
  | { state: "error" }

export function interpretSetupResult(result: ApiResult<AccountProfileResponse>): SetupOutcome {
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
      if (result.status === 400) return result.code === API_ERROR_CODES.invalidPhone ? { state: "invalid-phone" } : { state: "invalid" }
      if (result.status === 409) {
        if (result.code === ACCOUNT_ERROR_CODES.registrationIntentRequired) return { state: "intent-required" }
        if (result.code === ACCOUNT_ERROR_CODES.accountTypeConflict) return { state: "type-conflict" }
        return { state: "shop-exists" }
      }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}

/** After setup: a new buyer is offered the delivery address step (spec 05); a seller opens the dashboard. */
export function afterSetupHref(accountType: AccountType): string {
  return accountType === "BUYER" ? "/account/addresses/new?onboarding=1" : ACCOUNT_HOME[accountType]
}
