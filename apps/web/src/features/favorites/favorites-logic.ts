import { FAVORITE_ERROR_CODES, PRODUCT_ERROR_CODES, type FavoriteItem, type FavoriteList } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/**
 * Client side of favorites (spec 14). The list lives in the customer's account
 * and the API decides each product's current state; nothing here works out a
 * price or an availability. Favorites never touch the cart.
 */
export const FAVORITES_PATH = "/customers/me/favorites"

const favoritePath = (productId: string) => `${FAVORITES_PATH}/${encodeURIComponent(productId)}`

/** No body: the product is in the path and the owner comes from the session. */
export const addFavoriteRequest = (productId: string) => ({
  path: favoritePath(productId),
  init: { method: "PUT" } satisfies RequestInit,
})
export const removeFavoriteRequest = (productId: string) => ({
  path: favoritePath(productId),
  init: { method: "DELETE" } satisfies RequestInit,
})

export type FavoriteFailure = "product-not-found" | "limit-reached" | "rate-limited" | "unavailable" | "error"

export type FavoriteOutcome =
  { state: "ok"; list: FavoriteList } | { state: "signed-out" } | { state: "not-bootstrapped" } | { state: "failed"; failure: FavoriteFailure }

const FAILURE_BY_CODE: Record<string, FavoriteFailure> = {
  [PRODUCT_ERROR_CODES.notFound]: "product-not-found",
  [FAVORITE_ERROR_CODES.limitReached]: "limit-reached",
}

export function interpretFavoriteResult(result: ApiResult<FavoriteList>): FavoriteOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "ok", list: result.data }
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
      return {
        state: "failed",
        failure: (result.code === null ? undefined : FAILURE_BY_CODE[result.code]) ?? "error",
      }
  }
}

/** The products in the list, for the hearts on cards. */
export function favoriteIds(list: FavoriteList): ReadonlySet<string> {
  return new Set(list.items.map(({ productId }) => productId))
}

/**
 * Runs list requests one at a time, in the order asked, whether earlier ones
 * succeeded or failed. Every favorites answer is the whole list, so with one
 * request in flight each answer is the server's latest list and a slow earlier
 * answer can never replace a newer one.
 */
export function createRequestQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(request: () => Promise<T>): Promise<T> {
      const result = tail.then(request, request)
      tail = result.catch(() => undefined)
      return result
    },
  }
}

/** The count on the header heart, capped so it fits the badge. */
export function favoritesBadge(count: number): string {
  return count > 99 ? "99+" : String(count)
}

/** Only a product that is still public has a page to open. */
export function canOpenFavorite(item: FavoriteItem): boolean {
  return item.state !== "UNAVAILABLE" && item.product !== null
}
