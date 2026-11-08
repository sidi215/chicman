import {
  SHOP_ERROR_CODES,
  shopChangeRequestCreateSchema,
  shopCreateSchema,
  type OwnerShopResponse,
  type ShopStatus,
} from "@chicman/shared"
import type { z } from "zod"

import type { ApiResult } from "@/lib/api-client"

/** Fields the owner edits as text. `logoUrl` has its own upload flow. */
export const SHOP_FORM_FIELDS = ["shopName", "description", "contactPhone", "whatsappPhone", "city", "address"] as const
export type ShopFormField = (typeof SHOP_FORM_FIELDS)[number]
export type ShopFormValues = Record<ShopFormField, string>

export type ShopFieldErrorKey = "required" | "tooLong" | "invalid" | "invalidPhone"
export type ShopFieldErrors = Partial<Record<ShopFormField, ShopFieldErrorKey>>

/** Request bodies, built only from allowlisted keys. */
export interface ShopCreateBody {
  shopName: string
  description: string
  contactPhone: string
  city: string
  address: string
  whatsappPhone?: string
}
export type ShopUpdateBody = Partial<Record<ShopFormField, string>> & { whatsappPhone?: string | null; logoUrl?: null }
export interface ChangeRequestBody {
  shopName?: string
  city?: string
}

export type FormResult<Body> = { ok: true; body: Body } | { ok: false; errors: ShopFieldErrors }

const PHONE_FIELDS: readonly ShopFormField[] = ["contactPhone", "whatsappPhone"]
/** Fields that need administrator re-review once the shop is approved. */
export const REVIEW_FIELDS = ["shopName", "city"] as const satisfies readonly ShopFormField[]

export function emptyShopForm(): ShopFormValues {
  return { shopName: "", description: "", contactPhone: "", whatsappPhone: "", city: "", address: "" }
}

export function shopFormValues(shop: OwnerShopResponse): ShopFormValues {
  return {
    shopName: shop.shopName,
    description: shop.description,
    contactPhone: shop.contactPhone,
    whatsappPhone: shop.whatsappPhone ?? "",
    city: shop.city,
    address: shop.address,
  }
}

/** New values for a form: fields still equal to `baseline` take `next`; other fields are unsaved edits and stay. */
export function mergeShopFormValues(current: ShopFormValues, baseline: ShopFormValues, next: ShopFormValues): ShopFormValues {
  const merged = { ...current }
  for (const field of SHOP_FORM_FIELDS) {
    if (current[field] === baseline[field]) merged[field] = next[field]
  }
  return merged
}

/** Fields the owner may edit directly in a status (spec 06, rules 3, 4, 8). */
export function directlyEditableFields(status: ShopStatus): ShopFormField[] {
  if (status === "PENDING" || status === "REJECTED") return [...SHOP_FORM_FIELDS]
  if (status === "APPROVED") return SHOP_FORM_FIELDS.filter((field) => !(REVIEW_FIELDS as readonly string[]).includes(field))
  return []
}

function errorsFrom(error: z.ZodError): ShopFieldErrors {
  const errors: ShopFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== "string" || !(SHOP_FORM_FIELDS as readonly string[]).includes(field)) continue
    const key = field as ShopFormField
    if (errors[key]) continue
    if (PHONE_FIELDS.includes(key)) errors[key] = "invalidPhone"
    else if (issue.code === "too_small") errors[key] = "required"
    else if (issue.code === "too_big") errors[key] = "tooLong"
    else errors[key] = "invalid"
  }
  return errors
}

/** Validates every field with the shared schema (the same rules as the API). */
function normalize(values: ShopFormValues): { ok: true; data: z.output<typeof shopCreateSchema> } | { ok: false; errors: ShopFieldErrors } {
  const result = shopCreateSchema.safeParse({
    shopName: values.shopName,
    description: values.description,
    contactPhone: values.contactPhone,
    city: values.city,
    address: values.address,
    whatsappPhone: values.whatsappPhone.trim() === "" ? null : values.whatsappPhone,
  })
  return result.success ? { ok: true, data: result.data } : { ok: false, errors: errorsFrom(result.error) }
}

/** `POST /sellers/me/shop`: the initial application. */
export function buildShopCreate(values: ShopFormValues): FormResult<ShopCreateBody> {
  const result = normalize(values)
  if (!result.ok) return result
  const { whatsappPhone, ...required } = result.data
  return { ok: true, body: whatsappPhone ? { ...required, whatsappPhone } : required }
}

/**
 * `PATCH /sellers/me/shop`: only the fields that changed and that the
 * status allows. On an approved shop, `shopName`/`city` keep their current
 * values here (they go through a change request).
 */
export function buildShopUpdate(values: ShopFormValues, shop: OwnerShopResponse): FormResult<ShopUpdateBody> {
  const allowed = directlyEditableFields(shop.status)
  const merged: ShopFormValues = { ...shopFormValues(shop) }
  for (const field of allowed) merged[field] = values[field]
  const result = normalize(merged)
  if (!result.ok) return result
  const body: ShopUpdateBody = {}
  for (const field of allowed) {
    const next = field === "whatsappPhone" ? (result.data.whatsappPhone ?? null) : result.data[field]
    const current = field === "whatsappPhone" ? shop.whatsappPhone : shop[field]
    if (next !== current) (body as Record<string, string | null>)[field] = next
  }
  return { ok: true, body }
}

/** `POST /sellers/me/shop/change-requests`: proposed values that differ from the approved ones. */
export function buildChangeRequest(values: { shopName: string; city: string }, shop: OwnerShopResponse): FormResult<ChangeRequestBody> {
  const result = shopChangeRequestCreateSchema.safeParse({ shopName: values.shopName, city: values.city })
  if (!result.success) return { ok: false, errors: errorsFrom(result.error) }
  const body: ChangeRequestBody = {}
  if (result.data.shopName !== undefined && result.data.shopName !== shop.shopName) body.shopName = result.data.shopName
  if (result.data.city !== undefined && result.data.city !== shop.city) body.city = result.data.city
  return { ok: true, body }
}

export function isEmptyBody(body: object): boolean {
  return Object.keys(body).length === 0
}

/** What the dashboard does with a shop API response. */
export type ShopOutcome =
  | { state: "ok"; shop: OwnerShopResponse }
  | { state: "no-shop" }
  | { state: "already-exists" }
  | { state: "conflict" }
  | { state: "change-request-open" }
  | { state: "review-field" }
  | { state: "forbidden" }
  | { state: "invalid" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "rate-limited" }
  | { state: "error" }

export function interpretShopResult(result: ApiResult<OwnerShopResponse>): ShopOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "ok", shop: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "forbidden":
      return { state: "forbidden" }
    case "error":
      if (result.status === 404) return { state: "no-shop" }
      if (result.status === 400) return result.code === SHOP_ERROR_CODES.reviewFieldNotEditable ? { state: "review-field" } : { state: "invalid" }
      if (result.status === 409) {
        if (result.code === SHOP_ERROR_CODES.shopAlreadyExists) return { state: "already-exists" }
        if (result.code === SHOP_ERROR_CODES.changeRequestOpen) return { state: "change-request-open" }
        return { state: "conflict" }
      }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}
