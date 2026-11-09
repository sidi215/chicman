import { moneyAmountSchema, type ShopStatus } from "@chicman/shared"

/**
 * The shop's flat delivery fee (spec 06, D2): one amount in MRU per shop order,
 * `0` for free delivery. Once set it can be changed but never cleared, and while
 * it is not set the shop's products cannot be checked out (spec 10).
 */
export type DeliveryFeeError = "required" | "invalid"

export type DeliveryFeeResult = { ok: true; body: { deliveryFee: string } | null } | { ok: false; error: DeliveryFeeError }

/** Statuses in which the owner edits the fee (a suspended shop edits nothing). */
export function canEditDeliveryFee(status: ShopStatus): boolean {
  return status === "APPROVED" || status === "PENDING" || status === "REJECTED"
}

/**
 * The `PATCH /sellers/me/shop` body for the typed fee, or `null` when it is
 * unchanged. Accepts a decimal comma and grouping spaces ("1 500,5"); the API
 * applies the same schema.
 */
export function buildDeliveryFeeUpdate(input: string, current: string | null): DeliveryFeeResult {
  const typed = input.replace(/[\s  ]/g, "").replace(",", ".")
  if (typed === "") return { ok: false, error: "required" }
  const parsed = moneyAmountSchema.safeParse(typed)
  if (!parsed.success) return { ok: false, error: "invalid" }
  return { ok: true, body: parsed.data === current ? null : { deliveryFee: parsed.data } }
}
