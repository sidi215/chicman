import {
  customerCancellationSchema,
  DELIVERY_ERROR_CODES,
  ORDER_ERROR_CODES,
  sellerPaymentSummaryQuerySchema,
  type CustomerCancellationInput,
  type CustomerCancellationReason,
  type CustomerShopOrderDecision,
  type DeliveryFailureReason,
  type SellerCancellationReason,
  type SellerRejectionReason,
  type SellerShopOrderDecision,
  type ShopOrderReasonCode,
  type ShopOrderStatus,
} from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/**
 * Client side of order management (spec 11). The API decides every status,
 * every allowed action (`canCancel`, `actions`), and what each viewer may see;
 * these rules only choose what to show and what to send.
 */

export const CUSTOMER_ORDERS_PATH = "/customers/me/orders"
export const SELLER_ORDERS_PATH = "/sellers/me/orders"

export const customerOrderPath = (orderId: string): string => `${CUSTOMER_ORDERS_PATH}/${encodeURIComponent(orderId)}`
export const customerCancelPath = (orderId: string, shopOrderId: string): string =>
  `${customerOrderPath(orderId)}/shop-orders/${encodeURIComponent(shopOrderId)}/cancel`
export const sellerShopOrderPath = (shopOrderId: string): string => `${SELLER_ORDERS_PATH}/${encodeURIComponent(shopOrderId)}`
export const sellerActionPath = (shopOrderId: string, action: "confirm" | "reject" | "cancel"): string => `${sellerShopOrderPath(shopOrderId)}/${action}`

/** Seller delivery actions (spec 12). */
export type DeliveryAction = "ready" | "dispatch" | "delivered" | "fail" | "close"
export const deliveryActionPath = (shopOrderId: string, action: DeliveryAction): string => `${sellerShopOrderPath(shopOrderId)}/delivery/${action}`
/** The deliveries a seller must finish; all a suspended shop's owner can see (D8). */
export const IN_PROGRESS_DELIVERIES_PATH = "/sellers/me/deliveries/in-progress"

/** "Delivered, cash received": the amount the seller was shown, checked by the API against the amount due. */
export const deliveredBody = (amountDue: string): { amount: string } => ({ amount: amountDue })
export const failBody = (reason: DeliveryFailureReason): { reason: DeliveryFailureReason } => ({ reason })

/** The seller's collection summary (spec 13, section 9). */
export const SELLER_PAYMENT_SUMMARY_PATH = "/sellers/me/payments/summary"
export const SELLER_PAYMENTS_HREF = "/seller/payments"

export const paymentSummaryPath = (period: SummaryPeriod): string =>
  `${SELLER_PAYMENT_SUMMARY_PATH}?${new URLSearchParams({ from: period.from, to: period.to }).toString()}`

/** UTC days, both included, as the API reads them. */
export interface SummaryPeriod {
  from: string
  to: string
}

/** The current UTC month up to today. */
export function defaultSummaryPeriod(now: Date = new Date()): SummaryPeriod {
  const today = now.toISOString().slice(0, 10)
  return { from: `${today.slice(0, 8)}01`, to: today }
}

export type SummaryPeriodError = "required" | "order" | "tooLong"

/** Checked with the API's own schema before asking; `null` when the period is valid. */
export function summaryPeriodError(period: SummaryPeriod): SummaryPeriodError | null {
  if (period.from === "" || period.to === "") return "required"
  if (sellerPaymentSummaryQuerySchema.safeParse(period).success) return null
  return period.from > period.to ? "order" : "tooLong"
}

/** Page links in the web app. */
export const accountOrderHref = (orderId: string): string => `/account/orders/${encodeURIComponent(orderId)}`
export const sellerOrderHref = (shopOrderId: string): string => `/seller/orders/${encodeURIComponent(shopOrderId)}`
export const SELLER_DELIVERIES_HREF = "/seller/deliveries"

export function listQuery(page: number, status: ShopOrderStatus | null = null): string {
  const query = new URLSearchParams({ page: String(page) })
  if (status !== null) query.set("status", status)
  return `?${query.toString()}`
}

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize))

export type OrderFailure =
  | "not-found"
  | "forbidden"
  | "conflict"
  | "expired"
  | "amount-mismatch"
  | "invalid"
  | "rate-limited"
  | "unavailable"
  | "error"

export type OrderOutcome<T> = { state: "ok"; data: T } | { state: "signed-out" } | { state: "failed"; failure: OrderFailure }

const FAILURE_BY_CODE: Record<string, OrderFailure> = {
  [ORDER_ERROR_CODES.notFound]: "not-found",
  [ORDER_ERROR_CODES.shopOrderNotFound]: "not-found",
  [ORDER_ERROR_CODES.statusConflict]: "conflict",
  [ORDER_ERROR_CODES.expired]: "expired",
  [DELIVERY_ERROR_CODES.statusConflict]: "conflict",
  [DELIVERY_ERROR_CODES.amountMismatch]: "amount-mismatch",
}

export function interpretOrderResult<T>(result: ApiResult<T>): OrderOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      return { state: "failed", failure: "forbidden" }
    case "auth-unavailable":
    case "network-error":
      return { state: "failed", failure: "unavailable" }
    case "error":
      if (result.status === 429) return { state: "failed", failure: "rate-limited" }
      if (result.status === 503) return { state: "failed", failure: "unavailable" }
      if (result.status === 400) return { state: "failed", failure: "invalid" }
      return { state: "failed", failure: (result.code === null ? undefined : FAILURE_BY_CODE[result.code]) ?? "error" }
  }
}

/** After a conflict, an expiry, or a changed amount the shown state is out of date: read it again. */
export const needsReload = (failure: OrderFailure): boolean => failure === "conflict" || failure === "expired" || failure === "amount-mismatch"

export type CancellationTextError = "required" | "tooShort" | "tooLong" | "invalid"

/**
 * The customer's cancellation body, checked with the API's own schema: the
 * reason is optional, and `OTHER` (only `OTHER`) carries the text.
 */
export function customerCancellationBody(
  reason: CustomerCancellationReason | null,
  text: string
): { body: CustomerCancellationInput } | { error: CancellationTextError } {
  const candidate = reason === null ? {} : reason === "OTHER" ? { reason, reasonText: text } : { reason }
  const parsed = customerCancellationSchema.safeParse(candidate)
  if (parsed.success) return { body: parsed.data }
  if (text.trim() === "") return { error: "required" }
  const issue = parsed.error.issues[0]
  if (issue?.code === "too_small") return { error: "tooShort" }
  if (issue?.code === "too_big") return { error: "tooLong" }
  return { error: "invalid" }
}

export const sellerRejectionBody = (reason: SellerRejectionReason): { reason: SellerRejectionReason } => ({ reason })
export const sellerCancellationBody = (reason: SellerCancellationReason): { reason: SellerCancellationReason } => ({ reason })

/** What to say about a decision. */
export type DecisionText =
  | { kind: "reason"; code: ShopOrderReasonCode }
  | { kind: "chicman" }
  | { kind: "by-customer"; code: ShopOrderReasonCode | null; text: string | null }
  | { kind: "by-seller"; code: ShopOrderReasonCode | null }
  | null

/** The customer's side: the seller's or system's reason, or "Annulée par Chicman"; never their own text. */
export function customerDecisionText(decision: CustomerShopOrderDecision): DecisionText {
  if (decision.cancelledBy === "CHICMAN") return { kind: "chicman" }
  return decision.reason === null ? null : { kind: "reason", code: decision.reason }
}

/** The seller's side: the code, and for a customer's `OTHER` the customer's text (rendered as text, never markup). */
export function sellerDecisionText(decision: SellerShopOrderDecision): DecisionText {
  if (decision.cancelledBy === "CHICMAN") return { kind: "chicman" }
  if (decision.cancelledBy === "CUSTOMER") return { kind: "by-customer", code: decision.reason, text: decision.reasonText }
  if (decision.cancelledBy === "SELLER") return { kind: "by-seller", code: decision.reason }
  return decision.reason === null ? null : { kind: "reason", code: decision.reason }
}

/** A delivered shop order tells the customer that returns are arranged with the shop (D10). */
export const showsReturnsNotice = (status: ShopOrderStatus): boolean => status === "DELIVERED"

/** Shown until the seller answers. */
export const showsDeadline = (status: ShopOrderStatus): boolean => status === "PENDING"
