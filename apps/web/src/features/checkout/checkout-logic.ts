import {
  ADDRESS_ERROR_CODES,
  CHECKOUT_ERROR_CODES,
  expectedFigures,
  IDEMPOTENCY_KEY_HEADER,
  recipientNameSchema,
  type CheckoutPlacementInput,
  type CheckoutSummary,
  type CustomerOrder,
} from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/**
 * Client side of checkout (spec 10). The API decides every figure and every
 * blocking problem; these rules only choose what to show and what to send.
 */
export const CHECKOUT_PATH = "/customers/me/checkout"

/** Where checkout sends the customer to choose or add an address, and how it comes back. */
export const ADDRESS_SELECTION_PATH = "/account/addresses?select=checkout"
export const NEW_ADDRESS_FOR_CHECKOUT_PATH = "/account/addresses/new?returnTo=checkout"
export const checkoutPathFor = (addressId: string): string => `/checkout?addressId=${encodeURIComponent(addressId)}`

export function summaryPath(addressId: string | null): string {
  return addressId === null ? CHECKOUT_PATH : `${CHECKOUT_PATH}?addressId=${encodeURIComponent(addressId)}`
}

export type CheckoutFailure = "blocked" | "totals-changed" | "cart-empty" | "address-not-found" | "invalid" | "rate-limited" | "unavailable" | "error"

export type SummaryOutcome = { state: "ok"; summary: CheckoutSummary } | { state: "signed-out" } | { state: "not-bootstrapped" } | { state: "failed"; failure: CheckoutFailure }

export type PlacementOutcome =
  | { state: "placed"; order: CustomerOrder }
  | { state: "signed-out" }
  | { state: "not-bootstrapped" }
  | { state: "failed"; failure: CheckoutFailure }

const FAILURE_BY_CODE: Record<string, CheckoutFailure> = {
  [CHECKOUT_ERROR_CODES.blocked]: "blocked",
  [CHECKOUT_ERROR_CODES.totalsChanged]: "totals-changed",
  [CHECKOUT_ERROR_CODES.cartEmpty]: "cart-empty",
  [ADDRESS_ERROR_CODES.notFound]: "address-not-found",
}

function failureOf(result: Exclude<ApiResult<unknown>, { kind: "ok" | "unauthorized" | "forbidden" }>): CheckoutFailure {
  if (result.kind !== "error") return "unavailable"
  if (result.status === 429) return "rate-limited"
  if (result.status === 503) return "unavailable"
  if (result.status === 400) return "invalid"
  return (result.code === null ? undefined : FAILURE_BY_CODE[result.code]) ?? "error"
}

export function interpretSummaryResult(result: ApiResult<CheckoutSummary>): SummaryOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "ok", summary: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      return { state: "not-bootstrapped" }
    default:
      return { state: "failed", failure: failureOf(result) }
  }
}

/** `201` creates the order; `200` returns the one an earlier attempt with the same key created. */
export function interpretPlacementResult(result: ApiResult<CustomerOrder>): PlacementOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "placed", order: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      return { state: "not-bootstrapped" }
    default:
      return { state: "failed", failure: failureOf(result) }
  }
}

export type RecipientError = "required" | "tooLong" | "invalid"

/** The same rule as the API: 1–100 characters of plain text. */
export function recipientError(name: string): RecipientError | null {
  const result = recipientNameSchema.safeParse(name)
  if (result.success) return null
  const issue = result.error.issues[0]
  if (issue?.code === "too_small") return "required"
  if (issue?.code === "too_big") return "tooLong"
  return "invalid"
}

/** Placement is offered only when the API reported no problem and an address is chosen. */
export function canPlace(summary: CheckoutSummary): boolean {
  return summary.problems.length === 0 && summary.address !== null && expectedFigures(summary) !== null
}

/**
 * The placement body. `expected` repeats the figures the customer is shown, so
 * the API refuses the order if any of them changed; it never stores them.
 */
export function placementBody(summary: CheckoutSummary, recipientName: string): CheckoutPlacementInput | null {
  const expected = expectedFigures(summary)
  if (!canPlace(summary) || summary.address === null || expected === null) return null
  return { addressId: summary.address.addressId, recipientName, expected }
}

export function placementRequest(body: CheckoutPlacementInput, idempotencyKey: string): { path: string; init: RequestInit } {
  return {
    path: CHECKOUT_PATH,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      body: JSON.stringify(body),
    },
  }
}

/**
 * Whether the attempt's key must be kept for a retry. Only when the outcome is
 * unknown (no answer, or a temporary failure): the same key then returns the
 * order if the first request created it. Any definite answer ends the attempt.
 */
export function keepsAttemptKey(failure: CheckoutFailure): boolean {
  return failure === "unavailable"
}

/** The API refused because something changed: the summary must be read again before another attempt. */
export function needsFreshSummary(failure: CheckoutFailure): boolean {
  return failure === "blocked" || failure === "totals-changed" || failure === "cart-empty" || failure === "address-not-found"
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

/** A checkout address link may only carry a UUID: anything else falls back to the default address. */
export function addressIdFromQuery(value: string | string[] | undefined | null): string | null {
  const id = Array.isArray(value) ? value[0] : value
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null
}
