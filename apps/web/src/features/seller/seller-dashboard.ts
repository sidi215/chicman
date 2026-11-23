import type { OwnerShopResponse, ShopStatus } from "@chicman/shared"

import { withoutLocale } from "@/lib/locale"

/**
 * Seller dashboard shell (spec 16): which areas of `/seller` the current shop
 * status opens, and the existing API reads behind the overview's summaries.
 * This only decides what to show; every API route enforces its own rules, so
 * hiding a link is never the security control.
 */

export const SELLER_AREAS = ["overview", "shop", "products", "orders", "deliveries", "payments", "notifications", "profile"] as const
export type SellerArea = (typeof SELLER_AREAS)[number]

export const SELLER_AREA_HREF: Record<SellerArea, string> = {
  overview: "/seller",
  shop: "/seller/shop",
  products: "/seller/products",
  orders: "/seller/orders",
  deliveries: "/seller/deliveries",
  payments: "/seller/payments",
  notifications: "/seller/notifications",
  // The profile page every account type shares (Q2): profile, language, appearance.
  profile: "/account/profile",
}

/** What the shell knows about the signed-in user's shop. */
export type SellerShopState =
  | { state: "loading" }
  | { state: "no-shop" }
  | { state: "shop"; shop: OwnerShopResponse }
  | { state: "unavailable" }
  | { state: "error" }

/** `"none"`: the user has no shop yet (spec 06: they may apply). */
export type SellerAccess = ShopStatus | "none"

/**
 * Areas per shop status. Applicants (pending, rejected, or none yet) keep only
 * the application and status pages (spec 06). A suspended shop's owner keeps
 * the status page and the deliveries to finish (D8, spec 12 section 8).
 */
const AREAS_BY_ACCESS: Record<SellerAccess, readonly SellerArea[]> = {
  none: ["overview", "shop", "notifications", "profile"],
  PENDING: ["overview", "shop", "notifications", "profile"],
  REJECTED: ["overview", "shop", "notifications", "profile"],
  APPROVED: SELLER_AREAS,
  SUSPENDED: ["overview", "shop", "deliveries", "notifications", "profile"],
}

export function sellerAreas(access: SellerAccess): readonly SellerArea[] {
  return AREAS_BY_ACCESS[access]
}

export function isAreaAllowed(area: SellerArea, access: SellerAccess): boolean {
  return AREAS_BY_ACCESS[access].includes(area)
}

/** The access a loaded shop state gives; `null` while unknown (loading or failed). */
export function sellerAccess(shop: SellerShopState): SellerAccess | null {
  if (shop.state === "no-shop") return "none"
  if (shop.state === "shop") return shop.shop.status
  return null
}

/** The area a path belongs to, with or without a locale prefix; `null` outside `/seller`. */
export function sellerAreaOf(pathname: string): SellerArea | null {
  const path = withoutLocale(pathname).replace(/\/+$/, "")
  if (path === "/seller") return "overview"
  if (path === SELLER_AREA_HREF.profile) return "profile"
  const match = /^\/seller\/([^/]+)/.exec(path)
  const segment = match?.[1]
  return (SELLER_AREAS as readonly string[]).includes(segment ?? "") && segment !== "overview" ? (segment as SellerArea) : null
}

/**
 * What a seller page renders for its area: its content, a loading state while
 * the shop is read, or the restricted state of the current status. While the
 * shop cannot be read the content is shown: its own API calls decide.
 */
export type SellerGate = { kind: "page" } | { kind: "loading" } | { kind: "restricted"; access: SellerAccess }

export function sellerGate(area: SellerArea, shop: SellerShopState): SellerGate {
  if (shop.state === "loading") return { kind: "loading" }
  const access = sellerAccess(shop)
  if (access === null || isAreaAllowed(area, access)) return { kind: "page" }
  return { kind: "restricted", access }
}

/** An approved shop without a delivery fee cannot be checked out (D2): the dashboard asks for one. */
export const needsDeliveryFee = (shop: OwnerShopResponse): boolean => shop.status === "APPROVED" && shop.deliveryFee === null

// ---------------------------------------------------------------------------
// Overview summaries: existing feature APIs only (specs 07, 11, 12, 13)
// ---------------------------------------------------------------------------

export const SELLER_SHOP_PATH = "/sellers/me/shop"

/** One row is enough: the summaries read only the lists' `total`. */
export const sellerOrderCountPath = (status: "PENDING" | "CONFIRMED"): string => `/sellers/me/orders?status=${status}&page=1&pageSize=1`
export const sellerProductCountPath = (status: "PUBLISHED" | "DRAFT"): string => `/sellers/me/products?status=${status}&page=1&pageSize=1`
/** Spec 19: products restricted or under review, for the overview count. */
export const sellerModeratedCountPath = (moderationStatus: "RESTRICTED" | "IN_REVIEW"): string =>
  `/sellers/me/products?moderationStatus=${moderationStatus}&page=1&pageSize=1`
