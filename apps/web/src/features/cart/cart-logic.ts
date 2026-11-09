import { CART_ERROR_CODES, PRODUCT_ERROR_CODES, type Cart, type CartItem, type CartItemAddInput, type CartItemIssue } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/**
 * Client side of the cart (spec 09). Prices, stock, and availability are decided
 * by the API: nothing here works out a price, and these rules only choose which
 * controls to offer for the state the API reported.
 */
export const CART_PATH = "/customers/me/cart"

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

export const addItemRequest = (input: CartItemAddInput) => ({ path: `${CART_PATH}/items`, init: json("POST", input) })
export const setQuantityRequest = (itemId: string, quantity: number) => ({ path: `${CART_PATH}/items/${itemId}`, init: json("PATCH", { quantity }) })
export const acceptPriceRequest = (itemId: string, price: string) => ({ path: `${CART_PATH}/items/${itemId}/accept-price`, init: json("POST", { price }) })
export const removeItemRequest = (itemId: string) => ({ path: `${CART_PATH}/items/${itemId}`, init: { method: "DELETE" } satisfies RequestInit })

export type CartFailure =
  | "insufficient-stock"
  | "variant-required"
  | "variant-not-found"
  | "product-not-found"
  | "item-not-found"
  | "item-unavailable"
  | "price-changed"
  | "limit-reached"
  | "rate-limited"
  | "unavailable"
  | "error"

export type CartOutcome = { state: "ok"; cart: Cart } | { state: "signed-out" } | { state: "not-bootstrapped" } | { state: "failed"; failure: CartFailure }

const FAILURE_BY_CODE: Record<string, CartFailure> = {
  [CART_ERROR_CODES.insufficientStock]: "insufficient-stock",
  [CART_ERROR_CODES.variantRequired]: "variant-required",
  [CART_ERROR_CODES.variantNotFound]: "variant-not-found",
  [CART_ERROR_CODES.itemNotFound]: "item-not-found",
  [CART_ERROR_CODES.itemUnavailable]: "item-unavailable",
  [CART_ERROR_CODES.priceChanged]: "price-changed",
  [CART_ERROR_CODES.limitReached]: "limit-reached",
  [PRODUCT_ERROR_CODES.notFound]: "product-not-found",
}

export function interpretCartResult(result: ApiResult<Cart>): CartOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "ok", cart: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      // A valid token without account setup.
      return { state: "not-bootstrapped" }
    case "auth-unavailable":
    case "network-error":
      return { state: "failed", failure: "unavailable" }
    case "error":
      if (result.status === 429) return { state: "failed", failure: "rate-limited" }
      if (result.status === 503) return { state: "failed", failure: "unavailable" }
      return { state: "failed", failure: (result.code === null ? undefined : FAILURE_BY_CODE[result.code]) ?? "error" }
  }
}

const REMOVE_ONLY_ISSUES: readonly CartItemIssue["code"][] = ["SHOP_UNAVAILABLE", "PRODUCT_ARCHIVED", "PRODUCT_UNPUBLISHED", "VARIANT_UNAVAILABLE"]
const HIDDEN_PRODUCT_ISSUES: readonly CartItemIssue["code"][] = ["SHOP_UNAVAILABLE", "PRODUCT_ARCHIVED", "PRODUCT_UNPUBLISHED"]

const issueOf = <Code extends CartItemIssue["code"]>(item: CartItem, code: Code) =>
  item.issues.find((issue): issue is Extract<CartItemIssue, { code: Code }> => issue.code === code)

/** The product page still exists, so the line can link to it. */
export function canOpenProduct(item: CartItem): boolean {
  return !item.issues.some(({ code }) => HIDDEN_PRODUCT_ISSUES.includes(code))
}

export interface QuantityControls {
  /** `null` when the control is disabled. */
  decreaseTo: number | null
  increaseTo: number | null
  /** The quantity that resolves an insufficient-stock warning, when one can. */
  correctTo: number | null
}

/**
 * Which quantity changes to offer. Each is the customer's own action: nothing is
 * changed for them. A line above the stock can only go down to what is available,
 * since the API refuses any quantity above it; a sold-out line waits or is removed.
 */
export function quantityControls(item: CartItem): QuantityControls {
  if (item.issues.some(({ code }) => REMOVE_ONLY_ISSUES.includes(code))) return { decreaseTo: null, increaseTo: null, correctTo: null }
  const short = issueOf(item, "INSUFFICIENT_STOCK")
  if (short !== undefined) {
    const correctTo = short.availableQuantity > 0 ? short.availableQuantity : null
    return { decreaseTo: correctTo, increaseTo: null, correctTo }
  }
  return { decreaseTo: item.quantity > 1 ? item.quantity - 1 : null, increaseTo: item.quantity + 1, correctTo: null }
}

/** The price to acknowledge, when the line has a price change to acknowledge. */
export function priceToAccept(item: CartItem): string | null {
  return issueOf(item, "PRICE_CHANGED") === undefined ? null : item.unitPrice
}

/** Some lines are left out of the subtotal, which the page must say. */
export function hasExcludedItems(cart: Cart): boolean {
  return cart.shops.some(({ items }) => items.some((item) => !item.purchasable))
}

/** The count on the cart icon, capped so it fits the badge. */
export function cartBadge(count: number): string {
  return count > 99 ? "99+" : String(count)
}
