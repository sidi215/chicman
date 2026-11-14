import {
  ADMIN_SEARCH_MAX_LENGTH,
  adminOrderCancellationSchema,
  adminOrderListQuerySchema,
  normalizeOrderReferenceSearch,
  paymentNoteSchema,
  type ShopOrderStatus,
  type ShopStatus,
} from "@chicman/shared"

import { withoutLocale } from "@/lib/locale"

import { buildDecision, type DecisionFormResult } from "./admin-shops"

/**
 * Client side of the administrator dashboard (spec 17): areas, list queries,
 * paths, and form bodies. The API decides every permission, every allowed
 * action (`canCancel`), and the self-administration rule; these rules only
 * choose what to show and what to send.
 */

// ---------------------------------------------------------------------------
// Areas and navigation
// ---------------------------------------------------------------------------

export const ADMIN_AREAS = ["shops", "orders"] as const
export type AdminArea = (typeof ADMIN_AREAS)[number]

export const ADMIN_AREA_HREF: Record<AdminArea, string> = {
  shops: "/admin/shops",
  orders: "/admin/orders",
}

/** The area a path belongs to, with or without the locale prefix; `null` outside the admin area. */
export function adminAreaOf(pathname: string): AdminArea | null {
  const path = withoutLocale(pathname).replace(/\/+$/, "")
  const segment = /^\/admin\/([^/]+)/.exec(path)?.[1] ?? ""
  return (ADMIN_AREAS as readonly string[]).includes(segment) ? (segment as AdminArea) : null
}

/** Pages of a paginated list; at least one. */
export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize))

// ---------------------------------------------------------------------------
// Shop list (spec 06 review queue, with search and pagination)
// ---------------------------------------------------------------------------

export type AdminShopFilter = ShopStatus | "changes" | "all"
export const ADMIN_SHOP_FILTERS: readonly AdminShopFilter[] = ["PENDING", "changes", "APPROVED", "SUSPENDED", "REJECTED", "all"]

/** A search the API accepts, trimmed; `null` for an empty one (left out of the query). */
export function searchTerm(value: string): string | null {
  const trimmed = value.normalize("NFC").trim()
  if (trimmed === "") return null
  return trimmed.slice(0, ADMIN_SEARCH_MAX_LENGTH)
}

export function adminShopListPath(filter: AdminShopFilter, search: string, page: number): string {
  const query = new URLSearchParams()
  if (filter === "changes") query.set("openChangeRequest", "true")
  else if (filter !== "all") query.set("status", filter)
  const q = searchTerm(search)
  if (q !== null) query.set("q", q)
  query.set("page", String(page))
  return `/admin/shops?${query.toString()}`
}

// ---------------------------------------------------------------------------
// Order list (spec 11 `GET /admin/orders`, with reference search)
// ---------------------------------------------------------------------------

export const ADMIN_ORDERS_PATH = "/admin/orders"

export interface AdminOrderFilters {
  status: ShopOrderStatus | null
  shopId: string | null
  /** As typed; normalized before sending. */
  reference: string
  /** UTC days (`YYYY-MM-DD`), both included; empty when not set. */
  from: string
  to: string
}

export const EMPTY_ORDER_FILTERS: AdminOrderFilters = { status: null, shopId: null, reference: "", from: "", to: "" }

export type OrderFilterError = "reference" | "dateOrder"

export type OrderListQueryResult = { ok: true; path: string } | { ok: false; error: OrderFilterError }

/** The list request for these filters, checked with the API's own schema first. */
export function adminOrderListPath(filters: AdminOrderFilters, page: number): OrderListQueryResult {
  const query = new URLSearchParams()
  if (filters.status !== null) query.set("status", filters.status)
  if (filters.shopId !== null) query.set("shopId", filters.shopId)
  if (filters.reference.trim() !== "") {
    const code = normalizeOrderReferenceSearch(filters.reference)
    if (code === null) return { ok: false, error: "reference" }
    query.set("reference", code)
  }
  if (filters.from !== "") query.set("from", filters.from)
  if (filters.to !== "") query.set("to", filters.to)
  query.set("page", String(page))
  if (filters.from !== "" && filters.to !== "" && filters.from > filters.to) return { ok: false, error: "dateOrder" }
  if (!adminOrderListQuerySchema.safeParse(Object.fromEntries(query)).success) return { ok: false, error: "reference" }
  return { ok: true, path: `${ADMIN_ORDERS_PATH}?${query.toString()}` }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A `shopId` from the page URL, kept only when it is a UUID. */
export function shopIdFilter(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null
}

export const adminOrderPath = (shopOrderId: string): string => `${ADMIN_ORDERS_PATH}/${encodeURIComponent(shopOrderId)}`
export const adminOrderCancelPath = (shopOrderId: string): string => `${adminOrderPath(shopOrderId)}/cancel`
export const adminPaymentNotePath = (shopOrderId: string): string => `${adminOrderPath(shopOrderId)}/payment/notes`

/** Page links in the web app. */
export const adminOrderHref = (shopOrderId: string): string => `/admin/orders/${encodeURIComponent(shopOrderId)}`
export const adminShopHref = (shopId: string): string => `/admin/shops/${encodeURIComponent(shopId)}`
export const adminShopOrdersHref = (shopId: string): string => `/admin/orders?${new URLSearchParams({ shopId }).toString()}`

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * The administrator cancellation (spec 11, D6): a required internal reason
 * (10–500) and an optional internal note, the same schema as the API.
 */
export function buildOrderCancellation(reason: string, note: string): DecisionFormResult {
  const result = buildDecision("change-request", reason, note)
  if (result.ok && !adminOrderCancellationSchema.safeParse(result.body).success) return { ok: false, errors: { reason: "reasonInvalid" } }
  return result
}

export type PaymentNoteResult = { ok: true; body: { reason: string } } | { ok: false; error: "reasonLength" | "reasonInvalid" }

/** A payment correction note (spec 13): a reason only, 10–500 characters of plain text. */
export function buildPaymentNote(reason: string): PaymentNoteResult {
  const result = paymentNoteSchema.safeParse({ reason })
  if (result.success) return { ok: true, body: result.data }
  const length = result.error.issues.some((issue) => issue.code === "too_small" || issue.code === "too_big")
  return { ok: false, error: length ? "reasonLength" : "reasonInvalid" }
}
