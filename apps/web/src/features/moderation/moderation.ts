import {
  moderationDismissSchema,
  moderationRestoreSchema,
  moderationResubmitSchema,
  moderationSanctionSchema,
  PRODUCT_MODERATION_REASONS,
  PRODUCT_MODERATION_STATUSES,
  PRODUCT_REPORT_REASONS,
  type ModerationCaseStatus,
  type ProductModerationReason,
  type ProductModerationStatus,
  type ProductReportReason,
  type SellerProductDetail,
} from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

import { searchTerm } from "../admin/admin-dashboard"

/**
 * Client side of product moderation (spec 19). The API decides every
 * permission, transition, and visibility; these rules only choose what to
 * show and what to send, checked with the API's own schemas first.
 */

// ---------------------------------------------------------------------------
// API paths and page links
// ---------------------------------------------------------------------------

export const REPORT_PATH = "/customers/me/product-reports"
export const ADMIN_PRODUCTS_PATH = "/admin/products"
export const ADMIN_CASES_PATH = "/admin/moderation/cases"

export type AdminProductAction = "restrict" | "request-correction" | "restore" | "remove"

export const adminProductPath = (productId: string): string => `${ADMIN_PRODUCTS_PATH}/${encodeURIComponent(productId)}`
export const adminProductActionPath = (productId: string, action: AdminProductAction): string => `${adminProductPath(productId)}/moderation/${action}`
export const adminCasePath = (caseId: string): string => `${ADMIN_CASES_PATH}/${encodeURIComponent(caseId)}`
export const adminDismissPath = (caseId: string): string => `${adminCasePath(caseId)}/dismiss`
export const sellerModerationPath = (productId: string): string => `/sellers/me/products/${encodeURIComponent(productId)}/moderation`
export const sellerResubmitPath = (productId: string): string => `${sellerModerationPath(productId)}/resubmit`

/** Page links in the web app. */
export const adminProductHref = (productId: string): string => `/admin/products/${encodeURIComponent(productId)}`
export const adminCaseHref = (caseId: string): string => `/admin/moderation/${encodeURIComponent(caseId)}`
export const adminShopProductsHref = (shopId: string): string => `/admin/products?${new URLSearchParams({ shopId }).toString()}`
export const sellerProductHref = (productId: string): string => `/seller/products/${encodeURIComponent(productId)}`

/** `GET /admin/products`: name or shop search, shop and moderation filters. */
export function adminProductListPath(filters: { search: string; shopId: string | null; moderationStatus: ProductModerationStatus | null }, page: number): string {
  const query = new URLSearchParams()
  const q = searchTerm(filters.search)
  if (q !== null) query.set("q", q)
  if (filters.shopId !== null) query.set("shopId", filters.shopId)
  if (filters.moderationStatus !== null) query.set("moderationStatus", filters.moderationStatus)
  query.set("page", String(page))
  return `${ADMIN_PRODUCTS_PATH}?${query.toString()}`
}

/** The queue filters: the open queue (default), one case status, or closed cases. */
export type CaseQueueFilter = "queue" | "OPEN" | "IN_REVIEW" | "RESTRICTED" | "CLOSED"
export const CASE_QUEUE_FILTERS: readonly CaseQueueFilter[] = ["queue", "IN_REVIEW", "OPEN", "RESTRICTED", "CLOSED"]

/** `GET /admin/moderation/cases`. */
export function adminCaseListPath(filter: CaseQueueFilter, search: string, page: number, shopId: string | null = null): string {
  const query = new URLSearchParams()
  const status: ModerationCaseStatus | null = filter === "OPEN" ? "OPEN" : filter === "CLOSED" ? "CLOSED" : filter === "queue" ? null : "ACTIVE"
  if (status !== null) query.set("status", status)
  if (filter === "IN_REVIEW" || filter === "RESTRICTED") query.set("moderationStatus", filter)
  if (shopId !== null) query.set("shopId", shopId)
  const q = searchTerm(search)
  if (q !== null) query.set("q", q)
  query.set("page", String(page))
  return `${ADMIN_CASES_PATH}?${query.toString()}`
}

/** Open shop orders containing a product (the existing `GET /admin/orders`, spec 17). */
export const OPEN_ORDER_STATUSES = ["PENDING", "CONFIRMED"] as const
export const adminProductOrdersPath = (productId: string, status: (typeof OPEN_ORDER_STATUSES)[number]): string =>
  `/admin/orders?${new URLSearchParams({ productId, status, pageSize: "50" }).toString()}`

// ---------------------------------------------------------------------------
// Values from the URL
// ---------------------------------------------------------------------------

export const isModerationStatus = (value: unknown): value is ProductModerationStatus =>
  typeof value === "string" && (PRODUCT_MODERATION_STATUSES as readonly string[]).includes(value)
export const isModerationReason = (value: unknown): value is ProductModerationReason =>
  typeof value === "string" && (PRODUCT_MODERATION_REASONS as readonly string[]).includes(value)
export const isReportReason = (value: unknown): value is ProductReportReason => typeof value === "string" && (PRODUCT_REPORT_REASONS as readonly string[]).includes(value)

// ---------------------------------------------------------------------------
// Admin forms
// ---------------------------------------------------------------------------

export type ModerationField = "sellerReasonCode" | "sellerMessage" | "internalReason" | "internalNote" | "note"
export type ModerationFieldError = "required" | "length" | "invalid"
export type ModerationFormResult<B> = { ok: true; body: B } | { ok: false; errors: Partial<Record<ModerationField, ModerationFieldError>> }

function fieldErrors(issues: readonly { path: readonly PropertyKey[]; code: string }[]): Partial<Record<ModerationField, ModerationFieldError>> {
  const errors: Partial<Record<ModerationField, ModerationFieldError>> = {}
  for (const issue of issues) {
    const field = issue.path[0] as ModerationField
    if (errors[field] !== undefined) continue
    if (field === "sellerReasonCode") errors[field] = "required"
    else errors[field] = issue.code === "too_small" || issue.code === "too_big" ? "length" : "invalid"
  }
  return errors
}

const withOptional = (body: Record<string, string>, key: string, value: string): Record<string, string> =>
  value.trim() === "" ? body : { ...body, [key]: value }

/**
 * T3, T5, T7: a seller reason code, a seller message (10–1000), an internal
 * reason (10–500), an optional note, and the state shown on the page: the API
 * refuses the action (`409`) if the product changed meanwhile.
 */
export function buildSanction(expectedStatus: ProductModerationStatus, reasonCode: string | null, sellerMessage: string, internalReason: string, internalNote: string) {
  const candidate = withOptional({ expectedStatus, sellerReasonCode: reasonCode ?? "", sellerMessage, internalReason }, "internalNote", internalNote)
  const result = moderationSanctionSchema.safeParse(candidate)
  return result.success ? { ok: true as const, body: result.data } : { ok: false as const, errors: fieldErrors(result.error.issues) }
}

/** T6: an internal reason, an optional seller message and note, and the state shown on the page. */
export function buildRestore(expectedStatus: ProductModerationStatus, internalReason: string, sellerMessage: string, internalNote: string) {
  const candidate = withOptional(withOptional({ expectedStatus, internalReason }, "sellerMessage", sellerMessage), "internalNote", internalNote)
  const result = moderationRestoreSchema.safeParse(candidate)
  return result.success ? { ok: true as const, body: result.data } : { ok: false as const, errors: fieldErrors(result.error.issues) }
}

/** T2: an internal reason and an optional note. */
export function buildDismiss(internalReason: string, internalNote: string) {
  const result = moderationDismissSchema.safeParse(withOptional({ internalReason }, "internalNote", internalNote))
  return result.success ? { ok: true as const, body: result.data } : { ok: false as const, errors: fieldErrors(result.error.issues) }
}

/**
 * The actions an administrator can take from a state (section 3.2); the API
 * refuses anything else with `409`. `REMOVED` has none (PD-9).
 */
export function availableModerationActions(status: ProductModerationStatus): AdminProductAction[] {
  switch (status) {
    case "CLEAR":
      return ["restrict", "remove"]
    case "RESTRICTED":
      return ["restore", "remove"]
    case "IN_REVIEW":
      return ["restore", "request-correction", "remove"]
    case "REMOVED":
      return []
  }
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

/** The seller list filters for moderation (section 6): "Restreint", "En révision", "Retiré". */
export const SELLER_MODERATION_FILTERS = ["RESTRICTED", "IN_REVIEW", "REMOVED"] as const satisfies readonly ProductModerationStatus[]
export type SellerModerationFilter = (typeof SELLER_MODERATION_FILTERS)[number]

/** The seller list's moderation filter from the page URL (`?moderation=RESTRICTED`, from the overview). */
export function sellerModerationFilter(value: unknown): SellerModerationFilter | null {
  return typeof value === "string" && (SELLER_MODERATION_FILTERS as readonly string[]).includes(value) ? (value as SellerModerationFilter) : null
}
export const sellerModeratedProductsHref = (filter: SellerModerationFilter): string => `/seller/products?moderation=${filter}`

export interface SellerModerationRules {
  /** Show the moderation banner (reason and message). */
  moderated: boolean
  /** Editing is locked except stock (`IN_REVIEW`, PD-5). */
  stockOnly: boolean
  /** Nothing can change (`REMOVED`). */
  readOnly: boolean
  /** "Soumettre pour révision" is offered. */
  canResubmit: boolean
}

export function sellerModerationRules(product: Pick<SellerProductDetail, "moderation" | "status" | "images">): SellerModerationRules {
  const status = product.moderation.status
  return {
    moderated: status !== "CLEAR",
    stockOnly: status === "IN_REVIEW",
    readOnly: status === "REMOVED",
    canResubmit: status === "RESTRICTED" && product.status !== "ARCHIVED" && product.images.length > 0,
  }
}

export function buildResubmit(note: string) {
  const result = moderationResubmitSchema.safeParse(note.trim() === "" ? {} : { note })
  return result.success ? { ok: true as const, body: result.data } : { ok: false as const, errors: fieldErrors(result.error.issues) }
}

// ---------------------------------------------------------------------------
// Buyer report (section 4)
// ---------------------------------------------------------------------------

export const REPORT_DETAILS_MAX = 1000

export type ReportFormError = "reasonRequired" | "detailsRequired" | "detailsLength" | "detailsInvalid"
export type ReportFormResult = { ok: true; body: { productId: string; reasonCode: ProductReportReason; details?: string } } | { ok: false; error: ReportFormError }

/** A reason is required; a description too with `OTHER` (the S2-4 pattern); 0–1000 characters. */
export function buildReport(productId: string, reasonCode: ProductReportReason | null, details: string): ReportFormResult {
  if (reasonCode === null) return { ok: false, error: "reasonRequired" }
  const trimmed = details.normalize("NFC").trim()
  if (reasonCode === "OTHER" && trimmed === "") return { ok: false, error: "detailsRequired" }
  if (trimmed.length > REPORT_DETAILS_MAX) return { ok: false, error: "detailsLength" }
  // The API refuses control characters other than line feeds.
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(trimmed.replace(/\r\n?/g, "\n"))) return { ok: false, error: "detailsInvalid" }
  return { ok: true, body: { productId, reasonCode, ...(trimmed === "" ? {} : { details }) } }
}

export type ReportOutcome = "sent" | "sign-in" | "not-allowed" | "not-found" | "invalid" | "rate-limited" | "unavailable" | "error"

/** A report answer: `201` and `200` (a repeat) both read "Signalement envoyé" (PD-4). */
export function interpretReportResult(result: ApiResult<unknown>): ReportOutcome {
  switch (result.kind) {
    case "ok":
      return "sent"
    case "unauthorized":
      return "sign-in"
    case "forbidden":
      return "not-allowed"
    case "auth-unavailable":
    case "network-error":
      return "unavailable"
    case "error":
      if (result.status === 404) return "not-found"
      // `PRODUCT_REPORT_REASON_INVALID` or `BAD_REQUEST`: the form checks both first.
      if (result.status === 400) return "invalid"
      if (result.status === 429) return "rate-limited"
      if (result.status === 503) return "unavailable"
      return "error"
  }
}
